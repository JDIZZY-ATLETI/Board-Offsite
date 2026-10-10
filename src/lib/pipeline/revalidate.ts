import type { AppContext } from "@/lib/app-context";
import { InMemoryArielSnapshot } from "@/lib/ariel/snapshot";
import { parseEventsCsv } from "@/lib/events/parse";
import { buildRecord } from "@/lib/events/record";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import { lakeFinding, type EngineDeps } from "@/lib/rules/engine";
import type { IsoDate } from "@/types";
import { loadBatch } from "./run";
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
  const rates = await ctx.ariel.rates();
  const v = runValidation({ batch: { batchId, employerId: batch.employerId, executionDate: batch.executionDate as IsoDate }, parsed, records, snapshot, rates, config }, deps);
  return {
    batchId,
    rulesConfigHash: config.hash,
    arielSnapshotHash: snapshot.hash,
    findingsNdjson: v.findings.map((f) => JSON.stringify(lakeFinding(f))).join("\n") + (v.findings.length ? "\n" : ""),
    counts: { accepted: v.accepted.length, rejected: v.rejected.length, held: v.held.length, findings: v.findings.length },
  };
}