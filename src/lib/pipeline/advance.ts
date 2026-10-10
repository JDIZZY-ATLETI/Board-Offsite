import { and, asc, eq, inArray, isNotNull, max, ne } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { InMemoryArielSnapshot, type ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import { sha256Hex } from "@/lib/crypto/hash";
import type { DbOrTx } from "@/lib/db/client";
import { arielUpdateItems, arielUpdateSets, batches, eventsRecords, ledgerEntries, validationFindings } from "@/lib/db/schema";
import { countBy, deriveFinal, INFO_RET_DNCT, itemsHash, type FinalDerivation } from "@/lib/derivation/final";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import type { LedgerDraft } from "@/lib/ledger/service";
import { batchStream, memberStream, systemActor } from "@/lib/ledger/streams";
import { projectLedger } from "@/lib/projection";
import type { ArielUpdateItemCore, ArielUpdateProposedPayload, BatchStatus, CorrectionAppendedPayload, EventsRecord, IsoDate, LedgerEntry, UpdateSetBuiltPayload } from "@/types";
import { recordFromRow } from "./records";
import { PipelineError, sanitizeFailureReason } from "./run";
import { transitionBatch } from "./state-machine";
import { buildGoldDocument, renderDiffMd, renderGoldJson, renderModifiedFieldsReport, renderTransactionsReport, renderTransactionsSummary, renderUpdateSetCsv, updateSetCounts } from "./update-set/writers";

const ACTOR = systemActor("pipeline");
const CHUNK = 500;

type BatchRow = typeof batches.$inferSelect;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export interface DerivedRow {
  record: EventsRecord;
  derivation: FinalDerivation;
  hash: string;
}

/** Re-derives every accepted row of the batch from the persisted snapshot (pure, reproducible). */
export const INFO_NO_DERIVATION = "INFO-NO-DERIVATION";

export interface SkippedRow {
  record: EventsRecord;
  reason: "EVENT_DATE_MISSING" | "MEMBER_NOT_FOUND" | "EMPLOYMENT_NOT_FOUND";
}

/** Why an accepted row yields no Ariel items (section 18 Q30): recorded as an INFORMATION finding at build time. */
function skipReason(record: EventsRecord, snapshot: ArielBatchSnapshot, employerId: string): SkippedRow["reason"] {
  if (!record.eventDate) return "EVENT_DATE_MISSING";
  const member = record.sinPseudo ? snapshot.memberBySin(record.sinPseudo) : null;
  if (!member) return "MEMBER_NOT_FOUND";
  return member.employments.some((e) => e.employerId === employerId) ? "EVENT_DATE_MISSING" : "EMPLOYMENT_NOT_FOUND";
}

export async function deriveBatch(ctx: AppContext, batch: BatchRow): Promise<{ rows: DerivedRow[]; skipped: SkippedRow[]; snapshot: ArielBatchSnapshot }> {
  const paths = lakePaths({ employerId: batch.employerId, batchId: batch.batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  if (!(await ctx.lake.exists(paths.silver.arielSnapshot))) throw new PipelineError("Ariel snapshot for this batch is missing from the lake; the Update Set cannot be derived.");
  const snapshot = InMemoryArielSnapshot.fromNdjson((await ctx.lake.get(paths.silver.arielSnapshot)).toString("utf8"), batch.batchId);
  const rows = await ctx.db
    .select()
    .from(eventsRecords)
    .where(and(eq(eventsRecords.batchId, batch.batchId), eq(eventsRecords.outcome, "ACCEPTED")))
    .orderBy(asc(eventsRecords.lineNumber));
  const b139 = await ctx.db
    .select({ recordId: validationFindings.recordId })
    .from(validationFindings)
    .where(and(eq(validationFindings.batchId, batch.batchId), eq(validationFindings.ruleId, "B139"), isNotNull(validationFindings.overrideReason)));
  const b139Set = new Set(b139.map((f) => f.recordId));
  const out: DerivedRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const row of rows) {
    const record = recordFromRow(row);
    const derivation = deriveFinal({ record, snapshot, employerId: batch.employerId, executionDate: batch.executionDate as IsoDate, b139Overridden: b139Set.has(row.recordId) });
    if (!derivation) {
      skipped.push({ record, reason: skipReason(record, snapshot, batch.employerId) });
      continue;
    }
    out.push({ record, derivation, hash: itemsHash(derivation.items) });
  }
  return { rows: out, skipped, snapshot };
}

function proposedPayload(r: DerivedRow, employerId: string, arielSnapshotHash: string): ArielUpdateProposedPayload {
  const items = r.derivation.items;
  return {
    recordId: r.record.recordId,
    lineNumber: r.record.lineNumber,
    sinMasked: r.record.sinMasked,
    eventType: r.record.eventType ?? null,
    eventDate: r.record.eventDate ?? null,
    employerId,
    itemCount: items.length,
    itemsHash: r.hash,
    byRecordType: countBy(items, (i) => i.recordType),
    byOperation: countBy(items, (i) => i.operation),
    derivationRules: [...new Set(items.map((i) => i.derivationRule))].sort(),
    membershipStatus: r.derivation.membershipStatus,
    membershipStatusBefore: r.derivation.membershipStatus ? { status: r.derivation.derived.member.membership.status ?? null, subStatus: r.derivation.derived.member.membership.subStatus } : null,
    employmentTermination: r.derivation.employmentTermination,
    arielSnapshotHash,
  };
}

/**
 * Section 9.6 correction detection: an earlier, unexported `ArielUpdateProposed` for the same
 * (member, employer, eventType), or an earlier `MemberRecordRejected` for the same (member, eventType, eventDate).
 */
async function findCorrections(ctx: AppContext, batch: BatchRow, rows: DerivedRow[], proposals: Map<string, LedgerEntry>): Promise<LedgerDraft[]> {
  const streams = [...new Set(rows.map((r) => memberStream(r.record.sinPseudo!)))];
  const prior: LedgerEntry[] = [];
  for (const part of chunk(streams, CHUNK)) {
    const found = await ctx.db
      .select()
      .from(ledgerEntries)
      .where(and(inArray(ledgerEntries.streamId, part), ne(ledgerEntries.batchId, batch.batchId), inArray(ledgerEntries.eventType, ["ArielUpdateProposed", "MemberRecordRejected"])))
      .orderBy(asc(ledgerEntries.seq));
    for (const f of found) prior.push({ ...f, seq: Number(f.seq), streamSeq: Number(f.streamSeq), eventType: f.eventType as LedgerEntry["eventType"], payload: f.payload as Record<string, unknown>, occurredAt: new Date(f.occurredAt).toISOString() });
  }
  if (prior.length === 0) return [];
  const batchIds = [...new Set(prior.map((p) => p.batchId).filter((b): b is string => Boolean(b)))];
  const batchRows = batchIds.length ? await ctx.db.select({ batchId: batches.batchId, status: batches.status, employerId: batches.employerId }).from(batches).where(inArray(batches.batchId, batchIds)) : [];
  const batchInfo = new Map(batchRows.map((b) => [b.batchId, b]));
  const drafts: LedgerDraft[] = [];
  for (const r of rows) {
    const stream = memberStream(r.record.sinPseudo!);
    const mine = prior.filter((p) => p.streamId === stream);
    const newEntry = proposals.get(r.record.recordId);
    if (!newEntry) continue;
    const candidates = mine
      .filter((p) => {
        const b = p.batchId ? batchInfo.get(p.batchId) : undefined;
        if (!b || b.employerId !== batch.employerId) return false;
        const pl = p.payload as { eventType?: string | null; eventDate?: string | null };
        if (p.eventType === "ArielUpdateProposed") return pl.eventType === r.record.eventType && b.status !== "EXPORTED";
        return pl.eventType === r.record.eventType && pl.eventDate === r.record.eventDate;
      })
      .sort((a, b) => b.seq - a.seq);
    const target = candidates[0];
    if (!target) continue;
    const payload: CorrectionAppendedPayload = {
      recordId: r.record.recordId,
      lineNumber: r.record.lineNumber,
      sinMasked: r.record.sinMasked,
      eventType: r.record.eventType ?? null,
      eventDate: r.record.eventDate ?? null,
      kind: target.eventType === "ArielUpdateProposed" ? "RESUBMITTED_PROPOSAL" : "CORRECTED_REJECTION",
      supersedesEntryId: target.entryId,
      supersedesSeq: target.seq,
      supersedesBatchId: target.batchId,
      supersedesEventType: target.eventType,
      newEntryId: newEntry.entryId,
    };
    drafts.push({ streamId: stream, eventType: "CorrectionAppended", batchId: batch.batchId, actor: ACTOR, payload: payload as unknown as Record<string, unknown> });
  }
  return drafts;
}

/** `ledger` step (section 10.2): ArielUpdateProposed per accepted row (+ CorrectionAppended), VALIDATED -> LEDGERED. */
export async function stepLedger(ctx: AppContext, batch: BatchRow, rows: DerivedRow[]): Promise<Map<string, LedgerEntry>> {
  const proposals = new Map<string, LedgerEntry>();
  for (const part of chunk(rows, CHUNK)) {
    const entries = await ctx.ledger.appendMany(
      part.map((r) => ({
        streamId: memberStream(r.record.sinPseudo!),
        eventType: "ArielUpdateProposed" as const,
        batchId: batch.batchId,
        actor: ACTOR,
        payload: proposedPayload(r, batch.employerId, batch.arielSnapshotHash ?? "") as unknown as Record<string, unknown>,
      })),
    );
    part.forEach((r, i) => proposals.set(r.record.recordId, entries[i]));
  }
  const corrections = await findCorrections(ctx, batch, rows, proposals);
  for (const part of chunk(corrections, CHUNK)) await ctx.ledger.appendMany(part);
  await ctx.db.transaction((tx) => transitionBatch(tx, { batchId: batch.batchId, from: "VALIDATED", to: "LEDGERED", actor: ACTOR, at: ctx.clock().toISOString(), note: `proposed=${rows.length} corrections=${corrections.length}` }));
  return proposals;
}

/** Latest ArielUpdateProposed per record for the batch (used when the build step runs without the in-memory map). */
async function latestProposals(ctx: AppContext, batchId: string): Promise<Map<string, LedgerEntry>> {
  const rows = await ctx.db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.batchId, batchId), eq(ledgerEntries.eventType, "ArielUpdateProposed")))
    .orderBy(asc(ledgerEntries.seq));
  const out = new Map<string, LedgerEntry>();
  for (const r of rows) {
    const payload = r.payload as { recordId: string };
    out.set(payload.recordId, { ...r, seq: Number(r.seq), streamSeq: Number(r.streamSeq), eventType: "ArielUpdateProposed", payload: r.payload as Record<string, unknown>, occurredAt: new Date(r.occurredAt).toISOString() });
  }
  return out;
}

export interface BuildResult {
  updateSetId: string;
  buildNo: number;
  contentHash: string;
  itemCount: number;
  memberCount: number;
  ledgerSeq: number;
}

/**
 * `build-projection` step: ariel_update_sets + items, gold JSON/CSV/diff + Modified Fields / Transactions
 * reports, UpdateSetBuilt on the batch stream; LEDGERED -> PROJECTION_BUILT -> PENDING_APPROVAL.
 */
export async function stepBuild(ctx: AppContext, batch: BatchRow, rows: DerivedRow[], proposals?: Map<string, LedgerEntry>, skipped: SkippedRow[] = []): Promise<BuildResult> {
  const paths = lakePaths({ employerId: batch.employerId, batchId: batch.batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  const entries = proposals ?? (await latestProposals(ctx, batch.batchId));
  const allItems: ArielUpdateItemCore[] = [];
  const itemRows: Array<typeof arielUpdateItems.$inferInsert> = [];
  const updateSetId = ctx.newId();
  for (const r of rows) {
    const entry = entries.get(r.record.recordId);
    if (!entry) throw new PipelineError(`no ArielUpdateProposed ledger entry for line ${r.record.lineNumber}; the ledger step did not complete`);
    if ((entry.payload as { itemsHash?: string }).itemsHash !== r.hash) throw new PipelineError(`derivation for line ${r.record.lineNumber} no longer matches its ledgered itemsHash`);
    for (const it of r.derivation.items) {
      allItems.push(it);
      itemRows.push({
        itemId: ctx.newId(),
        updateSetId,
        sinPseudo: it.sinPseudo,
        sinMasked: it.sinMasked,
        memberDisplay: it.memberDisplay,
        employerId: it.employerId,
        recordId: r.record.recordId,
        lineNumber: it.lineNumber,
        eventType: it.eventType,
        eventDate: it.eventDate,
        recordType: it.recordType,
        operation: it.operation,
        yearScope: it.yearScope,
        targetKey: it.targetKey,
        fields: it.fields,
        beforeValues: it.before,
        sourceFields: it.sourceFields,
        derivationRule: it.derivationRule,
        explanation: it.explanation,
        calculated: it.calculated,
        ledgerEntryId: entry.entryId,
        sortOrder: it.sortOrder,
      });
    }
  }
  const doc = buildGoldDocument(allItems, { employerId: batch.employerId, executionDate: batch.executionDate as IsoDate });
  const contentHash = doc.contentHash;
  const counts = updateSetCounts(allItems);
  const rawByLine = new Map(rows.map((r) => [r.record.lineNumber, r.record.rawValues]));
  const artifacts: Record<string, string> = {
    json: paths.gold.updateSetJson,
    csv: paths.gold.updateSetCsv,
    diffMd: paths.gold.diffMd,
    modifiedFieldsReport: paths.gold.modifiedFieldsReport,
    transactionsReport: paths.gold.transactionsReport,
    transactionsSummary: paths.gold.transactionsSummary,
  };
  const bodies: Record<string, string> = {
    json: renderGoldJson(doc),
    csv: renderUpdateSetCsv(allItems),
    diffMd: renderDiffMd(doc),
    modifiedFieldsReport: renderModifiedFieldsReport(allItems, rawByLine),
    transactionsReport: renderTransactionsReport(allItems),
    transactionsSummary: renderTransactionsSummary(allItems, { rows: batch.rowsTotal, accepted: batch.rowsAccepted, rejected: batch.rowsRejected, held: batch.heldTotal }),
  };
  const artifactHashes: Record<string, string> = {};
  for (const [k, path] of Object.entries(artifacts)) {
    await ctx.lake.put(path, bodies[k], { overwrite: true });
    artifactHashes[k] = sha256Hex(bodies[k]);
  }

  const [{ maxBuild }] = await ctx.db.select({ maxBuild: max(arielUpdateSets.buildNo) }).from(arielUpdateSets).where(eq(arielUpdateSets.batchId, batch.batchId));
  const buildNo = Number(maxBuild ?? 0) + 1;
  const at = ctx.clock().toISOString();
  const payload: UpdateSetBuiltPayload = {
    updateSetId,
    buildNo,
    contentHash,
    itemCount: allItems.length,
    memberCount: doc.memberCount,
    byRecordType: counts.byRecordType as Record<string, number>,
    byOperation: counts.byOperation as Record<string, number>,
    artifacts,
    artifactHashes,
    arielSnapshotHash: batch.arielSnapshotHash ?? "",
    rulesConfigHash: batch.rulesConfigHash ?? "",
  };
  let ledgerSeq = 0;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(arielUpdateSets).values({ updateSetId, batchId: batch.batchId, buildNo, employerId: batch.employerId, status: "BUILDING", itemCount: allItems.length, memberCount: doc.memberCount, contentHash, counts: counts as unknown as Record<string, Record<string, number>>, artifacts, builtAt: at, updatedAt: at });
    for (const part of chunk(itemRows, 200)) await tx.insert(arielUpdateItems).values(part);
    await persistNotes(ctx, tx, batch, rows, skipped);
    await transitionBatch(tx, { batchId: batch.batchId, from: "LEDGERED", to: "PROJECTION_BUILT", actor: ACTOR, at, note: `updateSet=${updateSetId} items=${allItems.length} members=${doc.memberCount}` });
    const [entry] = await ctx.ledger.appendMany([{ streamId: batchStream(batch.batchId), eventType: "UpdateSetBuilt", batchId: batch.batchId, actor: ACTOR, payload: payload as unknown as Record<string, unknown> }], tx);
    ledgerSeq = entry.seq;
    await tx.update(arielUpdateSets).set({ status: "PENDING_APPROVAL", ledgerEntryId: entry.entryId, ledgerSeq: entry.seq, updatedAt: at }).where(eq(arielUpdateSets.updateSetId, updateSetId));
    await tx.update(batches).set({ updateSetId, updatedAt: at }).where(eq(batches.batchId, batch.batchId));
    await transitionBatch(tx, { batchId: batch.batchId, from: "PROJECTION_BUILT", to: "PENDING_APPROVAL", actor: ACTOR, at, note: `UpdateSetBuilt ledger #${entry.seq} contentHash=${contentHash.slice(0, 12)}` });
  });
  return { updateSetId, buildNo, contentHash, itemCount: allItems.length, memberCount: doc.memberCount, ledgerSeq };
}

const SKIP_MESSAGES: Record<SkippedRow["reason"], string> = {
  EVENT_DATE_MISSING: "No Ariel update derived: the row has no event date (DECFIN without DateOfDeath or EmploymentEndDate).",
  MEMBER_NOT_FOUND: "No Ariel update derived: the member is not in the Ariel snapshot.",
  EMPLOYMENT_NOT_FOUND: "No Ariel update derived: the member has no employment at the reporting employer.",
};

/**
 * Build-time INFORMATION findings (once per record): section 8.5 D-RET-REEVAL-NONE (`INFO-RET-DNCT`) and accepted
 * rows that yield no items (`INFO-NO-DERIVATION`, section 18 Q30).
 */
async function persistNotes(ctx: AppContext, tx: DbOrTx, batch: BatchRow, rows: DerivedRow[], skipped: SkippedRow[]): Promise<void> {
  const notes: Array<{ record: EventsRecord; rule: string; message: string; params: Record<string, string | number> }> = [];
  for (const r of rows) for (const n of r.derivation.notes) notes.push({ record: r.record, rule: n.rule, message: n.message, params: n.params });
  for (const s of skipped) notes.push({ record: s.record, rule: INFO_NO_DERIVATION, message: SKIP_MESSAGES[s.reason], params: { reason: s.reason } });
  if (notes.length === 0) return;
  const existing = await tx
    .select({ recordId: validationFindings.recordId, ruleId: validationFindings.ruleId })
    .from(validationFindings)
    .where(and(eq(validationFindings.batchId, batch.batchId), inArray(validationFindings.ruleId, [INFO_RET_DNCT, INFO_NO_DERIVATION])));
  const have = new Set(existing.map((e) => `${e.recordId}|${e.ruleId}`));
  const at = ctx.clock().toISOString();
  let added = 0;
  for (const n of notes) {
    if (have.has(`${n.record.recordId}|${n.rule}`)) continue;
    added += 1;
    await tx.insert(validationFindings).values({
      findingId: ctx.newId(),
      batchId: batch.batchId,
      recordId: n.record.recordId,
      lineNumber: n.record.lineNumber,
      sinPseudo: n.record.sinPseudo,
      ruleId: n.rule,
      messageId: n.rule,
      level: "L2",
      severity: "INFORMATION",
      visibility: "PUBLIC",
      field: "EventType",
      yearScope: null,
      params: n.params,
      dataImportMessage: n.message,
      portalMessage: n.message,
      overrideReasons: [],
      calculated: null,
      sortOrder: 1000,
      createdAt: at,
    });
  }
  if (added) await tx.update(batches).set({ infosTotal: batch.infosTotal + added }).where(eq(batches.batchId, batch.batchId));
}

/**
 * Automatic continuation (section 10.1): VALIDATED with no HELD rows -> LEDGERED -> PROJECTION_BUILT ->
 * PENDING_APPROVAL. Safe to call from the pipeline, the override API and reopen; a no-op otherwise.
 */
export async function advanceBatch(ctx: AppContext, batchId: string): Promise<BatchStatus> {
  const [batch] = await ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  if (!batch) throw new Error(`batch ${batchId} not found`);
  const log = ctx.logger.child({ batchId, employerId: batch.employerId });
  if (batch.status !== "VALIDATED" && batch.status !== "LEDGERED") return batch.status;
  if (batch.heldTotal > 0) {
    log.info({ held: batch.heldTotal }, "batch waits in VALIDATED: warnings need an override");
    return "VALIDATED";
  }
  try {
    const { rows, skipped } = await deriveBatch(ctx, batch);
    if (skipped.length) log.warn({ lines: skipped.map((s) => `${s.record.lineNumber}:${s.reason}`) }, "accepted rows yield no Ariel items (INFO-NO-DERIVATION)");
    const proposals = batch.status === "VALIDATED" ? await stepLedger(ctx, batch, rows) : undefined;
    const [ledgered] = await ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
    const built = await stepBuild(ctx, ledgered, rows, proposals, skipped);
    log.info({ updateSetId: built.updateSetId, items: built.itemCount, members: built.memberCount, contentHash: built.contentHash }, "update set built");
    await projectLedger(ctx);
    return "PENDING_APPROVAL";
  } catch (err) {
    const failureRef = ctx.newId();
    log.error({ err, failureRef }, "batch failed while building the update set");
    const reason = sanitizeFailureReason(err, failureRef);
    try {
      const [current] = await ctx.db.select({ status: batches.status }).from(batches).where(eq(batches.batchId, batchId));
      if (current && !["FAILED", "FILE_REJECTED", "PENDING_APPROVAL"].includes(current.status)) {
        await ctx.db.transaction((tx) => transitionBatch(tx, { batchId, from: current.status, to: "FAILED", actor: ACTOR, at: ctx.clock().toISOString(), note: reason, failureReason: reason }));
      }
    } catch (transitionErr) {
      log.error({ err: transitionErr, failureRef }, "could not record the FAILED transition");
    }
    return "FAILED";
  }
}