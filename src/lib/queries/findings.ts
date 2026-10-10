import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/app-context";
import { decodeCursor, encodeCursor } from "@/lib/api/pagination";
import { validationFindings } from "@/lib/db/schema";
import type { FindingSeverity, FindingVisibility, ValidationFinding } from "@/types";

type Row = typeof validationFindings.$inferSelect;

export function toFinding(r: Row): ValidationFinding {
  return {
    findingId: r.findingId,
    batchId: r.batchId,
    recordId: r.recordId,
    lineNumber: r.lineNumber,
    sinPseudo: r.sinPseudo,
    ruleId: r.ruleId,
    messageId: r.messageId,
    level: r.level,
    severity: r.severity,
    visibility: r.visibility,
    field: r.field as ValidationFinding["field"],
    yearScope: r.yearScope as ValidationFinding["yearScope"],
    params: r.params,
    dataImportMessage: r.dataImportMessage,
    portalMessage: r.portalMessage,
    overrideReasons: r.overrideReasons,
    ...(r.overrideReason
      ? { override: { reason: r.overrideReason, actor: r.overrideActor ?? "", at: r.overrideAt ? new Date(r.overrideAt).toISOString() : "", ...(r.overrideNote ? { note: r.overrideNote } : {}), ...(r.overrideLedgerSeq !== null && r.overrideLedgerSeq !== undefined ? { ledgerSeq: Number(r.overrideLedgerSeq) } : {}) } }
      : {}),
    ...(r.calculated ? { calculated: r.calculated } : {}),
    createdAt: new Date(r.createdAt).toISOString(),
    sortOrder: r.sortOrder,
  };
}

export interface ListFindingsParams {
  severity?: FindingSeverity;
  ruleId?: string;
  lineNumber?: number;
  visibility?: FindingVisibility;
  /** WARNING findings awaiting / carrying an override. */
  override?: "pending" | "done";
  includePrivate: boolean;
  cursor?: string | null;
  limit?: number;
}

const cursorSchema = z.object({ l: z.number().int(), s: z.number().int(), id: z.string() });

export async function listFindings(ctx: AppContext, batchId: string, p: ListFindingsParams): Promise<{ items: ValidationFinding[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const conds = [eq(validationFindings.batchId, batchId)];
  if (p.severity) conds.push(eq(validationFindings.severity, p.severity));
  if (p.ruleId) conds.push(eq(validationFindings.ruleId, p.ruleId));
  if (p.lineNumber !== undefined) conds.push(eq(validationFindings.lineNumber, p.lineNumber));
  if (!p.includePrivate) conds.push(eq(validationFindings.visibility, "PUBLIC"));
  else if (p.visibility) conds.push(eq(validationFindings.visibility, p.visibility));
  if (p.override === "pending") conds.push(eq(validationFindings.severity, "WARNING"), isNull(validationFindings.overrideReason));
  else if (p.override === "done") conds.push(isNotNull(validationFindings.overrideReason));
  const c = decodeCursor(p.cursor, cursorSchema);
  if (c) {
    conds.push(
      sql`(coalesce(${validationFindings.lineNumber}, -1), ${validationFindings.sortOrder}, ${validationFindings.findingId}) > (${c.l}, ${c.s}, ${c.id}::uuid)`,
    );
  }
  const rows = await ctx.db
    .select()
    .from(validationFindings)
    .where(and(...conds))
    .orderBy(sql`coalesce(${validationFindings.lineNumber}, -1)`, asc(validationFindings.sortOrder), asc(validationFindings.findingId))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(toFinding);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ l: last.lineNumber ?? -1, s: last.sortOrder, id: last.findingId }) : null };
}

export async function findingCountsByRecord(ctx: AppContext, batchId: string): Promise<Map<string, { cme: number; warning: number; info: number }>> {
  const rows = await ctx.db
    .select({ recordId: validationFindings.recordId, severity: validationFindings.severity, n: sql<number>`count(*)` })
    .from(validationFindings)
    .where(eq(validationFindings.batchId, batchId))
    .groupBy(validationFindings.recordId, validationFindings.severity);
  const m = new Map<string, { cme: number; warning: number; info: number }>();
  for (const r of rows) {
    if (!r.recordId) continue;
    const e = m.get(r.recordId) ?? { cme: 0, warning: 0, info: 0 };
    if (r.severity === "COMPLETE_MEMBER_ERROR") e.cme += Number(r.n);
    else if (r.severity === "WARNING") e.warning += Number(r.n);
    else if (r.severity === "INFORMATION") e.info += Number(r.n);
    m.set(r.recordId, e);
  }
  return m;
}

export interface FindingFacets {
  bySeverity: Array<{ value: FindingSeverity; count: number }>;
  byRule: Array<{ value: string; count: number }>;
  byField: Array<{ value: string; count: number }>;
  total: number;
}

/** Facet counts for the Findings filter bar (docs/ux-design.md section 5.4.2). Respects PRIVATE visibility. */
export async function findingFacets(ctx: AppContext, batchId: string, includePrivate: boolean): Promise<FindingFacets> {
  const base = [eq(validationFindings.batchId, batchId)];
  if (!includePrivate) base.push(eq(validationFindings.visibility, "PUBLIC"));
  const [sev, rule, field] = await Promise.all([
    ctx.db.select({ v: validationFindings.severity, n: sql<number>`count(*)` }).from(validationFindings).where(and(...base)).groupBy(validationFindings.severity),
    ctx.db.select({ v: validationFindings.ruleId, n: sql<number>`count(*)` }).from(validationFindings).where(and(...base)).groupBy(validationFindings.ruleId),
    ctx.db.select({ v: validationFindings.field, n: sql<number>`count(*)` }).from(validationFindings).where(and(...base)).groupBy(validationFindings.field),
  ]);
  const bySeverity = sev.map((r) => ({ value: r.v, count: Number(r.n) })).sort((a, b) => b.count - a.count);
  return {
    bySeverity,
    byRule: rule.map((r) => ({ value: r.v, count: Number(r.n) })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    byField: field.filter((r) => r.v !== null).map((r) => ({ value: r.v as string, count: Number(r.n) })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    total: bySeverity.reduce((s, r) => s + r.count, 0),
  };
}