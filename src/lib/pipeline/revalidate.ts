import { and, eq } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { InMemoryArielSnapshot } from "@/lib/ariel/snapshot";
import { batches, eventsRecords, validationFindings } from "@/lib/db/schema";
import { parseEventsCsv } from "@/lib/events/parse";
import { buildRecord } from "@/lib/events/record";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import { loadEffectiveRulesConfig } from "@/lib/rules/config-store";
import { lakeFinding, outcomeOf, type EngineDeps } from "@/lib/rules/engine";
import type { IsoDate, RecordOutcome, ValidationFinding } from "@/types";
import { findingRow, loadBatch, writeSummaryReports } from "./run";
import { deserializeRulesConfig, runValidation } from "./validate";

export interface OfflineRevalidation {
  batchId: string;
  rulesConfigHash: string;
  arielSnapshotHash: string;
  /** Findings in lake form (no ids/timestamps), identical to silver/findings.ndjson when deterministic (AC5). */
  findingsNdjson: string;
  counts: { accepted: number; rejected: number; held: number; findings: number };
}

/**
 * Offline re-validation (architecture section 7.6 / AC5): re-runs the engine from the persisted raw file,
 * Ariel snapshot and rules config only - no adapter call, no DB write.
 */
export async function revalidateOffline(ctx: AppContext, batchId: string, deps: EngineDeps = { newId: ctx.newId, now: ctx.clock }): Promise<OfflineRevalidation> {
  const loaded = await loadBatch(ctx, batchId);
  if (!loaded) throw new Error(`batch ${batchId} not found`);
  const { batch, rawFile } = loaded;
  const paths = lakePaths({ employerId: batch.employerId, batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  const [bytes, snapshotText, configText] = await Promise.all([ctx.lake.get(rawFile.lakePath), ctx.lake.get(paths.silver.arielSnapshot), ctx.lake.get(paths.silver.rulesConfig)]);
  const snapshot = InMemoryArielSnapshot.fromNdjson(snapshotText.toString("utf8"), batchId);
  const config = deserializeRulesConfig(configText.toString("utf8"));
  const parsed = parseEventsCsv(bytes);
  const records = parsed.rows.map((row) => buildRecord(row, { batchId, pseudonymKey: ctx.config.sinPseudonymKey, newId: deps.newId }));
  // Never the live adapter: the rates frozen with the snapshot are the only input (BUG-REVAL-1).
  const rates = snapshot.rates;
  if (!rates) throw new Error(`ariel snapshot for batch ${batchId} carries no rate tables; offline re-validation would not be reproducible`);
  const v = runValidation({ batch: { batchId, employerId: batch.employerId, executionDate: batch.executionDate as IsoDate }, parsed, records, snapshot, rates, config }, deps);
  return {
    batchId,
    rulesConfigHash: config.hash,
    arielSnapshotHash: snapshot.hash,
    findingsNdjson: v.findings.map((f) => JSON.stringify(lakeFinding(f))).join("\n") + (v.findings.length ? "\n" : ""),
    counts: { accepted: v.accepted.length, rejected: v.rejected.length, held: v.held.length, findings: v.findings.length },
  };
}
export interface RevalidationResult {
  previousRulesConfigHash: string;
  rulesConfigHash: string;
  counts: { accepted: number; rejected: number; held: number; findings: number };
  overridesCarried: number;
}

/**
 * Admin reopen with a changed rules configuration (section 10.1 "fix overrides / config -> rebuild"): re-runs
 * L1/L2 against the persisted Ariel snapshot and the *current* effective config, replaces the batch's
 * findings, carries existing overrides onto matching findings, recomputes row outcomes and counts.
 * Silver artifacts are write-once and are left untouched; the DB and the new build are authoritative.
 */
export async function revalidateBatch(ctx: AppContext, batchId: string, deps: EngineDeps = { newId: ctx.newId, now: ctx.clock }): Promise<RevalidationResult> {
  const loaded = await loadBatch(ctx, batchId);
  if (!loaded) throw new Error(`batch ${batchId} not found`);
  const { batch, rawFile } = loaded;
  if (batch.status !== "VALIDATED") throw new Error(`batch ${batchId} must be VALIDATED to re-validate (is ${batch.status})`);
  const paths = lakePaths({ employerId: batch.employerId, batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  const [bytes, snapshotText] = await Promise.all([ctx.lake.get(rawFile.lakePath), ctx.lake.get(paths.silver.arielSnapshot)]);
  const snapshot = InMemoryArielSnapshot.fromNdjson(snapshotText.toString("utf8"), batchId);
  const config = await loadEffectiveRulesConfig(ctx);
  const rates = snapshot.rates;
  if (!rates) throw new Error(`ariel snapshot for batch ${batchId} carries no rate tables`);
  const existingRows = await ctx.db.select({ recordId: eventsRecords.recordId, lineNumber: eventsRecords.lineNumber }).from(eventsRecords).where(eq(eventsRecords.batchId, batchId));
  const idByLine = new Map(existingRows.map((r) => [r.lineNumber, r.recordId]));
  const parsed = parseEventsCsv(bytes);
  const records = parsed.rows
    .map((row) => buildRecord(row, { batchId, pseudonymKey: ctx.config.sinPseudonymKey, newId: deps.newId }))
    .filter((r) => idByLine.has(r.lineNumber))
    .map((r) => ({ ...r, recordId: idByLine.get(r.lineNumber)! }));
  const v = runValidation({ batch: { batchId, employerId: batch.employerId, executionDate: batch.executionDate as IsoDate }, parsed, records, snapshot, rates, config }, deps);

  const old = await ctx.db.select().from(validationFindings).where(and(eq(validationFindings.batchId, batchId)));
  const overrideKey = (f: { recordId: string | null; ruleId: string; messageId: string; yearScope: string | null; field: string | null }) => `${f.recordId}|${f.ruleId}|${f.messageId}|${f.yearScope ?? ""}|${f.field ?? ""}`;
  const carried = new Map(old.filter((f) => f.overrideReason).map((f) => [overrideKey(f), f]));
  let overridesCarried = 0;
  const findings: ValidationFinding[] = v.findings.map((f) => {
    const prev = carried.get(overrideKey(f));
    if (!prev) return f;
    overridesCarried += 1;
    return { ...f, override: { reason: prev.overrideReason!, actor: prev.overrideActor ?? "", at: prev.overrideAt ? new Date(prev.overrideAt).toISOString() : "", ...(prev.overrideNote ? { note: prev.overrideNote } : {}), ...(prev.overrideLedgerSeq !== null ? { ledgerSeq: Number(prev.overrideLedgerSeq) } : {}) } };
  });
  const byRecord = new Map<string, ValidationFinding[]>();
  for (const f of findings) if (f.recordId) byRecord.set(f.recordId, [...(byRecord.get(f.recordId) ?? []), f]);
  const outcomes = new Map<string, RecordOutcome>();
  for (const r of records) outcomes.set(r.recordId, outcomeOf(byRecord.get(r.recordId) ?? []));
  const counts = {
    accepted: [...outcomes.values()].filter((o) => o === "ACCEPTED").length,
    rejected: [...outcomes.values()].filter((o) => o === "REJECTED").length,
    held: [...outcomes.values()].filter((o) => o === "HELD").length,
    findings: findings.length,
  };
  const at = ctx.clock().toISOString();
  await ctx.db.transaction(async (tx) => {
    await tx.delete(validationFindings).where(eq(validationFindings.batchId, batchId));
    for (let i = 0; i < findings.length; i += 200) {
      await tx.insert(validationFindings).values(
        findings.slice(i, i + 200).map((f) => ({
          ...findingRow(f),
          overrideReason: f.override?.reason ?? null,
          overrideActor: f.override?.actor ?? null,
          overrideAt: f.override?.at || null,
          overrideNote: f.override?.note ?? null,
          overrideLedgerSeq: f.override?.ledgerSeq ?? null,
        })),
      );
    }
    for (const [recordId, outcome] of outcomes) {
      await tx.update(eventsRecords).set({ accepted: outcome === "HELD" ? null : outcome === "ACCEPTED", outcome }).where(eq(eventsRecords.recordId, recordId));
    }
    await tx
      .update(batches)
      .set({
        rowsAccepted: counts.accepted,
        rowsRejected: counts.rejected,
        heldTotal: counts.held,
        warningsTotal: findings.filter((f) => f.severity === "WARNING").length,
        infosTotal: findings.filter((f) => f.severity === "INFORMATION").length,
        rulesConfigHash: config.hash,
        updatedAt: at,
      })
      .where(eq(batches.batchId, batchId));
  });
  await writeSummaryReports(ctx, paths, findings);
  return { previousRulesConfigHash: batch.rulesConfigHash ?? "", rulesConfigHash: config.hash, counts, overridesCarried };
}