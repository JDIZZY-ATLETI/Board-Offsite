import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { approvals, arielUpdateItems, arielUpdateSets, batches, exports as exportsTable, validationFindings } from "@/lib/db/schema";
import type { Approval, ArielOperation, ArielRecordType, ArielUpdateItem, ArielUpdateSet, EventType, ExportRecord, IsoDate, UpdateSetCounts, YearScope } from "@/types";

type SetRow = typeof arielUpdateSets.$inferSelect;
type ItemRow = typeof arielUpdateItems.$inferSelect;

export function toUpdateSet(r: SetRow): ArielUpdateSet {
  return {
    updateSetId: r.updateSetId,
    batchId: r.batchId,
    employerId: r.employerId ?? "",
    buildNo: r.buildNo,
    status: r.status,
    itemCount: r.itemCount,
    memberCount: r.memberCount,
    contentHash: r.contentHash ?? "",
    counts: (r.counts as unknown as UpdateSetCounts) ?? { byRecordType: {}, byOperation: {}, byEventType: {} },
    artifacts: r.artifacts,
    ledgerEntryId: r.ledgerEntryId,
    ledgerSeq: r.ledgerSeq === null ? null : Number(r.ledgerSeq),
    builtAt: r.builtAt ? new Date(r.builtAt).toISOString() : new Date(r.updatedAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

export function toItem(r: ItemRow): ArielUpdateItem {
  return {
    itemId: r.itemId,
    updateSetId: r.updateSetId,
    recordId: r.recordId,
    ledgerEntryId: r.ledgerEntryId,
    sinPseudo: r.sinPseudo,
    sinMasked: r.sinMasked ?? "***-***-***",
    memberDisplay: r.memberDisplay,
    employerId: r.employerId,
    lineNumber: r.lineNumber ?? 0,
    eventType: (r.eventType ?? "TERFIN") as EventType,
    eventDate: (r.eventDate ?? "") as IsoDate,
    recordType: r.recordType as ArielRecordType,
    operation: r.operation,
    yearScope: (r.yearScope as YearScope | null) ?? null,
    targetKey: r.targetKey as ArielUpdateItem["targetKey"],
    fields: r.fields as ArielUpdateItem["fields"],
    before: (r.beforeValues as ArielUpdateItem["before"]) ?? null,
    sourceFields: (r.sourceFields as ArielUpdateItem["sourceFields"]) ?? [],
    derivationRule: r.derivationRule,
    explanation: r.explanation,
    calculated: (r.calculated as ArielUpdateItem["calculated"]) ?? null,
    sortOrder: r.sortOrder,
  };
}

export function toApproval(r: typeof approvals.$inferSelect): Approval {
  return {
    approvalId: r.approvalId,
    updateSetId: r.updateSetId,
    decision: r.decision as Approval["decision"],
    actor: r.actor,
    role: r.role,
    reason: r.reason,
    contentHashAtDecision: r.contentHashAtDecision,
    decidedAt: new Date(r.decidedAt).toISOString(),
    ledgerEntryId: r.ledgerEntryId,
  };
}

export function toExport(r: typeof exportsTable.$inferSelect): ExportRecord {
  return {
    exportId: r.exportId,
    updateSetId: r.updateSetId,
    batchId: r.batchId ?? "",
    actor: r.actor,
    format: r.format as ExportRecord["format"],
    contentHash: r.contentHash ?? "",
    exportedAt: new Date(r.exportedAt).toISOString(),
    exportDir: r.exportDir ?? "",
    files: r.files,
    ledgerEntryId: r.ledgerEntryId,
    ledgerSeq: r.ledgerSeq === null ? null : Number(r.ledgerSeq),
  };
}

/** Current (latest build) update set of a batch, or null before the first build. */
export async function getCurrentUpdateSet(ctx: AppContext, batchId: string): Promise<ArielUpdateSet | null> {
  const [b] = await ctx.db.select({ updateSetId: batches.updateSetId }).from(batches).where(eq(batches.batchId, batchId));
  if (!b) return null;
  if (b.updateSetId) {
    const [row] = await ctx.db.select().from(arielUpdateSets).where(eq(arielUpdateSets.updateSetId, b.updateSetId));
    if (row) return toUpdateSet(row);
  }
  const [latest] = await ctx.db.select().from(arielUpdateSets).where(eq(arielUpdateSets.batchId, batchId)).orderBy(desc(arielUpdateSets.buildNo)).limit(1);
  return latest ? toUpdateSet(latest) : null;
}

export async function getUpdateSetById(ctx: AppContext, updateSetId: string): Promise<ArielUpdateSet | null> {
  const [row] = await ctx.db.select().from(arielUpdateSets).where(eq(arielUpdateSets.updateSetId, updateSetId));
  return row ? toUpdateSet(row) : null;
}

export async function listUpdateSetsForBatch(ctx: AppContext, batchId: string): Promise<ArielUpdateSet[]> {
  const rows = await ctx.db.select().from(arielUpdateSets).where(eq(arielUpdateSets.batchId, batchId)).orderBy(asc(arielUpdateSets.buildNo));
  return rows.map(toUpdateSet);
}

export async function listApprovals(ctx: AppContext, updateSetId: string): Promise<Approval[]> {
  const rows = await ctx.db.select().from(approvals).where(eq(approvals.updateSetId, updateSetId)).orderBy(asc(approvals.decidedAt));
  return rows.map(toApproval);
}

export async function listExports(ctx: AppContext, updateSetId: string): Promise<ExportRecord[]> {
  const rows = await ctx.db.select().from(exportsTable).where(eq(exportsTable.updateSetId, updateSetId)).orderBy(asc(exportsTable.exportedAt));
  return rows.map(toExport);
}

export async function getExport(ctx: AppContext, exportId: string): Promise<ExportRecord | null> {
  const [row] = await ctx.db.select().from(exportsTable).where(eq(exportsTable.exportId, exportId));
  return row ? toExport(row) : null;
}

export async function listItems(ctx: AppContext, updateSetId: string): Promise<ArielUpdateItem[]> {
  const rows = await ctx.db.select().from(arielUpdateItems).where(eq(arielUpdateItems.updateSetId, updateSetId)).orderBy(asc(arielUpdateItems.sinPseudo), asc(arielUpdateItems.lineNumber), asc(arielUpdateItems.sortOrder));
  return rows.map(toItem);
}

export interface UpdateSetItemFilters {
  recordType?: ArielRecordType;
  operation?: ArielOperation;
  eventType?: EventType;
  sinPseudo?: string;
  /** Last-3 digits of the SIN or a name fragment (matched on memberDisplay). */
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface UpdateSetMemberGroup {
  sinPseudo: string;
  sinMasked: string;
  memberDisplay: string;
  recordId: string | null;
  lineNumber: number;
  eventType: EventType;
  eventDate: IsoDate;
  itemCount: number;
  ledgerEntryId: string;
  overrides: Array<{ findingId: string; ruleId: string; messageId: string; reason: string; actor: string; at: string; note: string | null }>;
  groups: Array<{ recordType: ArielRecordType; items: ArielUpdateItem[] }>;
}

export interface UpdateSetView {
  updateSet: ArielUpdateSet;
  approvals: Approval[];
  exports: ExportRecord[];
  members: UpdateSetMemberGroup[];
  nextCursor: string | null;
  filteredItemCount: number;
}

/** UX section 5.4.4: member accordion -> record-type groups -> items; paginated over members (cursor = sinPseudo|line). */
export async function getUpdateSetView(ctx: AppContext, set: ArielUpdateSet, f: UpdateSetItemFilters = {}): Promise<UpdateSetView> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const conds = [eq(arielUpdateItems.updateSetId, set.updateSetId)];
  if (f.recordType) conds.push(eq(arielUpdateItems.recordType, f.recordType));
  if (f.operation) conds.push(eq(arielUpdateItems.operation, f.operation));
  if (f.eventType) conds.push(eq(arielUpdateItems.eventType, f.eventType));
  if (f.sinPseudo) conds.push(eq(arielUpdateItems.sinPseudo, f.sinPseudo));
  const rows = (await ctx.db.select().from(arielUpdateItems).where(and(...conds)).orderBy(asc(arielUpdateItems.sinPseudo), asc(arielUpdateItems.lineNumber), asc(arielUpdateItems.sortOrder))).map(toItem);
  const q = f.q?.trim().toLowerCase();
  const items = q ? rows.filter((i) => i.memberDisplay.toLowerCase().includes(q) || i.sinMasked.endsWith(q)) : rows;
  const members = new Map<string, UpdateSetMemberGroup>();
  for (const it of items) {
    const key = `${it.sinPseudo}|${it.lineNumber}`;
    let m = members.get(key);
    if (!m) {
      m = { sinPseudo: it.sinPseudo, sinMasked: it.sinMasked, memberDisplay: it.memberDisplay, recordId: it.recordId, lineNumber: it.lineNumber, eventType: it.eventType, eventDate: it.eventDate, itemCount: 0, ledgerEntryId: it.ledgerEntryId, overrides: [], groups: [] };
      members.set(key, m);
    }
    m.itemCount += 1;
    let g = m.groups.find((x) => x.recordType === it.recordType);
    if (!g) {
      g = { recordType: it.recordType, items: [] };
      m.groups.push(g);
    }
    g.items.push(it);
  }
  const all = [...members.values()];
  const start = f.cursor ? all.findIndex((m) => `${m.sinPseudo}|${m.lineNumber}` > f.cursor!) : 0;
  const page = start < 0 ? [] : all.slice(start, start + limit);
  const nextCursor = start >= 0 && start + limit < all.length ? `${page[page.length - 1].sinPseudo}|${page[page.length - 1].lineNumber}` : null;
  const recordIds = page.map((m) => m.recordId).filter((r): r is string => Boolean(r));
  if (recordIds.length) {
    const overrides = await ctx.db
      .select()
      .from(validationFindings)
      .where(and(inArray(validationFindings.recordId, recordIds), eq(validationFindings.severity, "WARNING")))
      .orderBy(asc(validationFindings.sortOrder));
    for (const o of overrides) {
      if (!o.overrideReason) continue;
      const m = page.find((x) => x.recordId === o.recordId);
      m?.overrides.push({ findingId: o.findingId, ruleId: o.ruleId, messageId: o.messageId, reason: o.overrideReason, actor: o.overrideActor ?? "", at: o.overrideAt ? new Date(o.overrideAt).toISOString() : "", note: o.overrideNote ?? null });
    }
  }
  return { updateSet: set, approvals: await listApprovals(ctx, set.updateSetId), exports: await listExports(ctx, set.updateSetId), members: page, nextCursor, filteredItemCount: items.length };
}

/** Batch-level summary for the batch detail response (Submitters see status + rejection reason only). */
export async function updateSetSummaryForBatch(ctx: AppContext, batchId: string) {
  const set = await getCurrentUpdateSet(ctx, batchId);
  if (!set) return null;
  const [appr, exps] = await Promise.all([listApprovals(ctx, set.updateSetId), listExports(ctx, set.updateSetId)]);
  const approved = appr.find((a) => a.decision === "APPROVED") ?? null;
  const rejected = [...appr].reverse().find((a) => a.decision === "REJECTED") ?? null;
  return {
    updateSetId: set.updateSetId,
    buildNo: set.buildNo,
    status: set.status,
    contentHash: set.contentHash,
    itemCount: set.itemCount,
    memberCount: set.memberCount,
    counts: set.counts,
    builtAt: set.builtAt,
    ledgerSeq: set.ledgerSeq,
    approval: approved ? { actor: approved.actor, role: approved.role, at: approved.decidedAt, note: approved.reason } : null,
    rejection: rejected ? { actor: rejected.actor, role: rejected.role, at: rejected.decidedAt, reason: rejected.reason } : null,
    exports: exps.map((e) => ({ exportId: e.exportId, format: e.format, exportedAt: e.exportedAt, actor: e.actor, files: e.files.map((f) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })), ledgerSeq: e.ledgerSeq })),
  };
}