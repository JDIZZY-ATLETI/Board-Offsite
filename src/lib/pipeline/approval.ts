import { and, eq, inArray } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { ApiError, notFound } from "@/lib/api/errors";
import { canAccessEmployer } from "@/lib/auth/roles";
import { sha256Hex } from "@/lib/crypto/hash";
import { approvals, arielUpdateSets, auditLog, batches, eventsRecords, exports as exportsTable } from "@/lib/db/schema";
import { formatsFor, type ExportMember, type ExportPayload } from "@/lib/export";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import { batchStream } from "@/lib/ledger/streams";
import { decryptSin } from "@/lib/pii/sin";
import { projectLedger } from "@/lib/projection";
import { getCurrentUpdateSet, getUpdateSetById, listItems, toApproval, toExport } from "@/lib/queries/update-sets";
import type { Approval, ArielUpdateItemCore, ArielUpdateSet, BatchReopenedPayload, BatchStatus, ExportFile, ExportFormatRequest, ExportRecord, IsoDate, Session, UpdateSetApprovedPayload, UpdateSetExportedPayload, UpdateSetRejectedPayload } from "@/types";
import { loadEffectiveRulesConfig } from "@/lib/rules/config-store";
import { advanceBatch } from "./advance";
import { revalidateBatch, type RevalidationResult } from "./revalidate";
import { transitionBatch } from "./state-machine";

type BatchRow = typeof batches.$inferSelect;

export interface ActionOpts {
  ip?: string | null;
}

function ipOf(ip: string | null | undefined): string | null {
  return ip && /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null;
}

async function audit(ctx: AppContext, session: Session, action: string, target: string, details: Record<string, unknown>, at: string, ip?: string | null): Promise<void> {
  await ctx.db.insert(auditLog).values({ at, actor: session.actor, role: session.role, action, target, ip: ipOf(ip), details });
}

/** Resolves batch + its current update set from either id; Submitters are scoped to their employer (404 otherwise). */
export async function resolveUpdateSet(ctx: AppContext, session: Session, ref: { batchId?: string; updateSetId?: string }): Promise<{ batch: BatchRow; set: ArielUpdateSet | null }> {
  let batchId = ref.batchId;
  let set: ArielUpdateSet | null = null;
  if (ref.updateSetId) {
    set = await getUpdateSetById(ctx, ref.updateSetId);
    if (!set) throw notFound("update set");
    batchId = set.batchId;
  }
  const [batch] = await ctx.db.select().from(batches).where(eq(batches.batchId, batchId!));
  if (!batch || !canAccessEmployer(session, batch.employerId)) throw notFound("batch");
  if (!set) set = await getCurrentUpdateSet(ctx, batch.batchId);
  return { batch, set };
}

function requireCurrentPending(batch: BatchRow, set: ArielUpdateSet | null, contentHash: string): ArielUpdateSet {
  if (batch.heldTotal > 0) throw new ApiError(422, "HELD_ROWS", `${batch.heldTotal} row(s) still need a warning override before the Update Set can be decided.`, { held: batch.heldTotal });
  if (!set) throw new ApiError(422, "UPDATE_SET_NOT_BUILT", "The Update Set has not been built yet.");
  if (batch.updateSetId && batch.updateSetId !== set.updateSetId) throw new ApiError(409, "NOT_CURRENT_UPDATE_SET", "This Update Set was superseded by a rebuild. Reload to review the current version.", { currentUpdateSetId: batch.updateSetId });
  if (batch.status !== "PENDING_APPROVAL" || set.status !== "PENDING_APPROVAL") throw new ApiError(422, "BATCH_NOT_PENDING", `The Update Set is not pending approval (batch ${batch.status}, update set ${set.status}).`);
  if (contentHash !== set.contentHash) throw new ApiError(409, "STALE_CONTENT_HASH", "This Update Set was rebuilt (content hash changed). Reload to review the current version.", { currentContentHash: set.contentHash });
  return set;
}

export interface ApproveInput {
  contentHash: string;
  note: string;
  attest: true;
}

/** Architecture section 11 approve: Reviewer/Admin, 409 on stale hash, 422 while HELD rows or wrong status. */
export async function approveUpdateSet(ctx: AppContext, session: Session, ref: { batchId?: string; updateSetId?: string }, input: ApproveInput, opts: ActionOpts = {}): Promise<{ approval: Approval; updateSet: ArielUpdateSet; batchStatus: BatchStatus; ledgerSeq: number }> {
  const { batch, set: maybe } = await resolveUpdateSet(ctx, session, ref);
  const set = requireCurrentPending(batch, maybe, input.contentHash);
  const at = ctx.clock().toISOString();
  const approvalId = ctx.newId();
  const payload: UpdateSetApprovedPayload = { updateSetId: set.updateSetId, approvalId, contentHash: set.contentHash, itemCount: set.itemCount, memberCount: set.memberCount, note: input.note, role: session.role };
  const result = await ctx.db.transaction(async (tx) => {
    const [entry] = await ctx.ledger.appendMany([{ streamId: batchStream(batch.batchId), eventType: "UpdateSetApproved", batchId: batch.batchId, actor: session.actor, payload: payload as unknown as Record<string, unknown> }], tx);
    const [row] = await tx
      .insert(approvals)
      .values({ approvalId, updateSetId: set.updateSetId, decision: "APPROVED", actor: session.actor, role: session.role, reason: input.note, contentHashAtDecision: set.contentHash, decidedAt: at, ledgerEntryId: entry.entryId })
      .returning();
    await tx.update(arielUpdateSets).set({ status: "APPROVED", updatedAt: at }).where(eq(arielUpdateSets.updateSetId, set.updateSetId));
    await tx.update(batches).set({ approvedBy: session.actor, approvedAt: at, updatedAt: at }).where(eq(batches.batchId, batch.batchId));
    await transitionBatch(tx, { batchId: batch.batchId, from: "PENDING_APPROVAL", to: "APPROVED", actor: session.actor, at, note: `approved updateSet=${set.updateSetId} ledger #${entry.seq}` });
    await tx.insert(auditLog).values({ at, actor: session.actor, role: session.role, action: "APPROVE_UPDATE_SET", target: `update-set:${set.updateSetId}`, ip: ipOf(opts.ip), details: { batchId: batch.batchId, contentHash: set.contentHash, ledgerSeq: entry.seq } });
    return { approval: toApproval(row), ledgerSeq: entry.seq };
  });
  await projectLedger(ctx);
  return { ...result, updateSet: { ...set, status: "APPROVED" }, batchStatus: "APPROVED" };
}

export interface RejectInput {
  contentHash: string;
  reason: string;
}

/** Reject: PENDING_APPROVAL -> REJECTED (section 10.1); the batch stays REJECTED until an Admin reopens it. */
export async function rejectUpdateSet(ctx: AppContext, session: Session, ref: { batchId?: string; updateSetId?: string }, input: RejectInput, opts: ActionOpts = {}): Promise<{ approval: Approval; updateSet: ArielUpdateSet; batchStatus: BatchStatus; ledgerSeq: number }> {
  const { batch, set: maybe } = await resolveUpdateSet(ctx, session, ref);
  const set = requireCurrentPending(batch, maybe, input.contentHash);
  const at = ctx.clock().toISOString();
  const approvalId = ctx.newId();
  const payload: UpdateSetRejectedPayload = { updateSetId: set.updateSetId, approvalId, contentHash: set.contentHash, reason: input.reason, role: session.role };
  const result = await ctx.db.transaction(async (tx) => {
    const [entry] = await ctx.ledger.appendMany([{ streamId: batchStream(batch.batchId), eventType: "UpdateSetRejected", batchId: batch.batchId, actor: session.actor, payload: payload as unknown as Record<string, unknown> }], tx);
    const [row] = await tx
      .insert(approvals)
      .values({ approvalId, updateSetId: set.updateSetId, decision: "REJECTED", actor: session.actor, role: session.role, reason: input.reason, contentHashAtDecision: set.contentHash, decidedAt: at, ledgerEntryId: entry.entryId })
      .returning();
    await tx.update(arielUpdateSets).set({ status: "REJECTED", updatedAt: at }).where(eq(arielUpdateSets.updateSetId, set.updateSetId));
    await tx.update(batches).set({ rejectedBy: session.actor, rejectedAt: at, rejectedReason: input.reason, updatedAt: at }).where(eq(batches.batchId, batch.batchId));
    await transitionBatch(tx, { batchId: batch.batchId, from: "PENDING_APPROVAL", to: "REJECTED", actor: session.actor, at, note: input.reason.slice(0, 500) });
    await tx.insert(auditLog).values({ at, actor: session.actor, role: session.role, action: "REJECT_UPDATE_SET", target: `update-set:${set.updateSetId}`, ip: ipOf(opts.ip), details: { batchId: batch.batchId, contentHash: set.contentHash, reason: input.reason, ledgerSeq: entry.seq } });
    return { approval: toApproval(row), ledgerSeq: entry.seq };
  });
  await projectLedger(ctx);
  return { ...result, updateSet: { ...set, status: "REJECTED" }, batchStatus: "REJECTED" };
}

/** Admin reopen: REJECTED -> VALIDATED, then the automatic continuation rebuilds when nothing is HELD. */
export interface ReopenOptions extends ActionOpts {
  /** Force L1/L2 re-validation with the current rules config (automatic when the config hash changed). */
  revalidate?: boolean;
}

export async function reopenBatch(ctx: AppContext, session: Session, batchId: string, reason: string, opts: ReopenOptions = {}): Promise<{ batchStatus: BatchStatus; heldRows: number; ledgerSeq: number; updateSetId: string | null; revalidation: RevalidationResult | null }> {
  const [batch] = await ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  if (!batch) throw notFound("batch");
  if (batch.status !== "REJECTED") throw new ApiError(422, "BATCH_NOT_REJECTED", `Only a rejected batch can be reopened (current: ${batch.status}).`);
  const at = ctx.clock().toISOString();
  const payload: BatchReopenedPayload = { updateSetId: batch.updateSetId, reason, heldRows: batch.heldTotal };
  const seq = await ctx.db.transaction(async (tx) => {
    const [entry] = await ctx.ledger.appendMany([{ streamId: batchStream(batchId), eventType: "BatchReopened", batchId, actor: session.actor, payload: payload as unknown as Record<string, unknown> }], tx);
    await tx.update(batches).set({ reopenedBy: session.actor, reopenedAt: at, updatedAt: at }).where(eq(batches.batchId, batchId));
    await transitionBatch(tx, { batchId, from: "REJECTED", to: "VALIDATED", actor: session.actor, at, note: `reopened: ${reason.slice(0, 400)}` });
    await tx.insert(auditLog).values({ at, actor: session.actor, role: session.role, action: "REOPEN_BATCH", target: `batch:${batchId}`, ip: ipOf(opts.ip), details: { reason, previousUpdateSetId: batch.updateSetId, ledgerSeq: entry.seq } });
    return entry.seq;
  });
  // Section 10.1 "fix overrides / config": a changed rules configuration is applied before the rebuild.
  const config = await loadEffectiveRulesConfig(ctx);
  let revalidation: RevalidationResult | null = null;
  if (opts.revalidate || config.hash !== batch.rulesConfigHash) {
    revalidation = await revalidateBatch(ctx, batchId);
    ctx.logger.info({ batchId, ...revalidation.counts, from: revalidation.previousRulesConfigHash.slice(0, 12), to: revalidation.rulesConfigHash.slice(0, 12) }, "batch re-validated on reopen");
  }
  const status = await advanceBatch(ctx, batchId);
  const [after] = await ctx.db.select({ heldTotal: batches.heldTotal, updateSetId: batches.updateSetId }).from(batches).where(eq(batches.batchId, batchId));
  return { batchStatus: status, heldRows: after.heldTotal, ledgerSeq: seq, updateSetId: after.updateSetId, revalidation };
}

export function exportDirFor(ctx: AppContext, batch: BatchRow, exportId: string): string {
  if (ctx.config.exportDir) return `${ctx.config.exportDir}/employer=${batch.employerId}/batch=${batch.batchId}/${exportId}`;
  const paths = lakePaths({ employerId: batch.employerId, batchId: batch.batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  return `${paths.gold.exportsDir}/${exportId}`;
}

/**
 * Export (section 10.2 / 13.3): the only code path that decrypts `events_records.sin_enc` for Ariel. Files go to
 * the export directory via `ArielExportFormat`s; sha256 of every file lands in `exports` and on the chain.
 */
export async function exportUpdateSet(ctx: AppContext, session: Session, ref: { batchId?: string; updateSetId?: string }, format: ExportFormatRequest, opts: ActionOpts = {}): Promise<{ export: ExportRecord; batchStatus: BatchStatus }> {
  const { batch, set } = await resolveUpdateSet(ctx, session, ref);
  if (!set) throw new ApiError(422, "UPDATE_SET_NOT_BUILT", "The Update Set has not been built yet.");
  if (batch.updateSetId && batch.updateSetId !== set.updateSetId) throw new ApiError(409, "NOT_CURRENT_UPDATE_SET", "This Update Set was superseded by a rebuild.", { currentUpdateSetId: batch.updateSetId });
  if (batch.status === "EXPORTED" || set.status === "EXPORTED") throw new ApiError(422, "ALREADY_EXPORTED", "This Update Set has already been exported.");
  if (batch.status !== "APPROVED" || set.status !== "APPROVED") throw new ApiError(422, "BATCH_NOT_APPROVED", `Only an approved Update Set can be exported (batch ${batch.status}).`);

  const items = await listItems(ctx, set.updateSetId);
  const recordIds = [...new Set(items.map((i) => i.recordId).filter((r): r is string => Boolean(r)))];
  const sinByRecord = new Map<string, { sin: string; lastName: string | null; firstName: string | null }>();
  for (let i = 0; i < recordIds.length; i += 500) {
    const rows = await ctx.db
      .select({ recordId: eventsRecords.recordId, sinEnc: eventsRecords.sinEnc, lastName: eventsRecords.lastName, firstName: eventsRecords.firstName })
      .from(eventsRecords)
      .where(and(eq(eventsRecords.batchId, batch.batchId), inArray(eventsRecords.recordId, recordIds.slice(i, i + 500))));
    for (const r of rows) if (r.sinEnc) sinByRecord.set(r.recordId, { sin: decryptSin(ctx.config.sinEncKey, r.sinEnc), lastName: r.lastName, firstName: r.firstName });
  }
  const members = new Map<string, ExportMember>();
  for (const it of items) {
    const key = `${it.sinPseudo}|${it.lineNumber}`;
    let m = members.get(key);
    if (!m) {
      const id = it.recordId ? sinByRecord.get(it.recordId) : undefined;
      if (!id) throw new ApiError(500, "EXPORT_SIN_UNAVAILABLE", `No encrypted SIN for line ${it.lineNumber}; export aborted.`);
      m = { sin: id.sin, sinMasked: it.sinMasked, sinPseudo: it.sinPseudo, lastName: id.lastName, firstName: id.firstName, employerId: it.employerId, lineNumber: it.lineNumber, eventType: it.eventType, eventDate: it.eventDate, items: [] };
      members.set(key, m);
    }
    const { itemId: _a, updateSetId: _b, recordId: _c, ledgerEntryId: _d, ...core } = it;
    void _a;
    void _b;
    void _c;
    void _d;
    m.items.push(core as ArielUpdateItemCore);
  }
  const exportId = ctx.newId();
  const at = ctx.clock().toISOString();
  const dir = exportDirFor(ctx, batch, exportId);
  const payload: ExportPayload = {
    schemaVersion: 1,
    exportId,
    updateSetId: set.updateSetId,
    batchId: batch.batchId,
    employerId: batch.employerId,
    executionDate: batch.executionDate as IsoDate,
    contentHash: set.contentHash,
    exportedAt: at,
    exportedBy: session.actor,
    itemCount: items.length,
    memberCount: members.size,
    members: [...members.values()],
  };
  const files: ExportFile[] = [];
  for (const fmt of formatsFor(format)) {
    const bytes = fmt.render(payload);
    const path = `${dir}/${fmt.filename}`;
    await ctx.lake.put(path, bytes, { contentType: fmt.contentType });
    files.push({ name: fmt.filename, path, sha256: sha256Hex(bytes), bytes: bytes.length, contentType: fmt.contentType });
  }
  const manifest = { schemaVersion: 1, exportId, updateSetId: set.updateSetId, batchId: batch.batchId, employerId: batch.employerId, contentHash: set.contentHash, format, exportedAt: at, exportedBy: session.actor, itemCount: items.length, memberCount: members.size, files: files.map((f) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const manifestPath = `${dir}/export-manifest.json`;
  await ctx.lake.put(manifestPath, manifestBytes, { contentType: "application/json" });
  files.push({ name: "export-manifest.json", path: manifestPath, sha256: sha256Hex(manifestBytes), bytes: manifestBytes.length, contentType: "application/json; charset=utf-8" });

  const ledgerPayload: UpdateSetExportedPayload = { exportId, updateSetId: set.updateSetId, contentHash: set.contentHash, format, files: files.map((f) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })), itemCount: items.length, memberCount: members.size };
  const row = await ctx.db.transaction(async (tx) => {
    const [entry] = await ctx.ledger.appendMany([{ streamId: batchStream(batch.batchId), eventType: "UpdateSetExported", batchId: batch.batchId, actor: session.actor, payload: ledgerPayload as unknown as Record<string, unknown> }], tx);
    const json = files.find((f) => f.name.endsWith(".json") && f.name !== "export-manifest.json");
    const csv = files.find((f) => f.name.endsWith(".csv"));
    const [inserted] = await tx
      .insert(exportsTable)
      .values({
        exportId,
        updateSetId: set.updateSetId,
        batchId: batch.batchId,
        actor: session.actor,
        format,
        contentHash: set.contentHash,
        exportedAt: at,
        exportDir: dir,
        jsonPath: json?.path ?? null,
        csvPath: csv?.path ?? null,
        manifestPath,
        jsonSha256: json?.sha256 ?? null,
        csvSha256: csv?.sha256 ?? null,
        manifestSha256: files[files.length - 1].sha256,
        files,
        ledgerEntryId: entry.entryId,
        ledgerSeq: entry.seq,
      })
      .returning();
    await tx.update(arielUpdateSets).set({ status: "EXPORTED", updatedAt: at }).where(eq(arielUpdateSets.updateSetId, set.updateSetId));
    await tx.update(batches).set({ exportedAt: at, updatedAt: at }).where(eq(batches.batchId, batch.batchId));
    await transitionBatch(tx, { batchId: batch.batchId, from: "APPROVED", to: "EXPORTED", actor: session.actor, at, note: `export ${exportId} (${format}) ledger #${entry.seq}` });
    await tx.insert(auditLog).values({ at, actor: session.actor, role: session.role, action: "EXPORT_UPDATE_SET", target: `export:${exportId}`, ip: ipOf(opts.ip), details: { batchId: batch.batchId, updateSetId: set.updateSetId, format, files: files.map((f) => ({ name: f.name, sha256: f.sha256 })), ledgerSeq: entry.seq } });
    return inserted;
  });
  await projectLedger(ctx);
  return { export: toExport(row), batchStatus: "EXPORTED" };
}

/** Admin download of one export file; audit-logged because the files carry raw SINs (section 13.3). */
export async function readExportFile(ctx: AppContext, session: Session, exp: ExportRecord, name: string, opts: ActionOpts = {}): Promise<{ bytes: Buffer; file: ExportFile }> {
  const file = exp.files.find((f) => f.name === name);
  if (!file) throw notFound(`export file ${name}`);
  if (!(await ctx.lake.exists(file.path))) throw notFound(`export file ${name}`);
  const bytes = await ctx.lake.get(file.path);
  if (sha256Hex(bytes) !== file.sha256) throw new ApiError(500, "EXPORT_INTEGRITY", "The export file on disk no longer matches its recorded sha256.");
  await audit(ctx, session, "DOWNLOAD_EXPORT", `export:${exp.exportId}/${name}`, { batchId: exp.batchId, updateSetId: exp.updateSetId, sha256: file.sha256, bytes: file.bytes }, ctx.clock().toISOString(), opts.ip);
  return { bytes, file };
}