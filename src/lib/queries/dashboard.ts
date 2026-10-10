import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { batches, rawFiles, validationFindings } from "@/lib/db/schema";
import type { BatchStatus, FindingSeverity } from "@/types";
import { toBatch, type BatchSummary } from "./batches";

export interface DashboardKpis {
  batchesToday: number;
  inProgress: number;
  pendingApproval: number;
  /** Oldest PENDING_APPROVAL receivedAt, when any. */
  oldestPendingAt: string | null;
  /** Rows rejected / rows, last 30 days; null when no rows. */
  rejectionRate30d: number | null;
  rejectedRows30d: number;
  rows30d: number;
  /** Rate for the preceding 30-day window (for the delta). */
  rejectionRatePrev30d: number | null;
}

export interface DashboardData {
  kpis: DashboardKpis;
  needsAttention: BatchSummary[];
  recent: BatchSummary[];
  generatedAt: string;
}

const IN_PROGRESS: BatchStatus[] = ["RECEIVED", "PARSED", "LEDGERED", "PROJECTION_BUILT"];
const ATTENTION: BatchStatus[] = ["PENDING_APPROVAL", "FAILED", "FILE_REJECTED"];

export interface FindingsByRuleRow {
  ruleId: string;
  severity: FindingSeverity;
  findings: number;
  rows: number;
  batches: number;
  overridden: number;
}

/**
 * docs/ux-design.md section 5.1 "Findings by rule - last 30 days": top N rules by finding count across batches received
 * in the window (Reviewer/Admin; PRIVATE findings included only when `includePrivate`).
 */
export async function findingsByRule(ctx: AppContext, opts: { days?: number; limit?: number; includePrivate: boolean; scopeEmployerId?: string | null } = { includePrivate: false }): Promise<{ items: FindingsByRuleRow[]; totalFindings: number; since: string; batches: number }> {
  const days = opts.days ?? 30;
  const limit = opts.limit ?? 8;
  const since = new Date(ctx.clock().getTime() - days * 86_400_000).toISOString();
  const conds = [gte(batches.receivedAt, since), isNotNull(validationFindings.recordId)];
  if (!opts.includePrivate) conds.push(eq(validationFindings.visibility, "PUBLIC"));
  if (opts.scopeEmployerId) conds.push(eq(batches.employerId, opts.scopeEmployerId));
  const rows = await ctx.db
    .select({
      ruleId: validationFindings.ruleId,
      severity: validationFindings.severity,
      findings: sql<number>`count(*)::int`,
      rows: sql<number>`count(distinct ${validationFindings.recordId})::int`,
      batches: sql<number>`count(distinct ${validationFindings.batchId})::int`,
      overridden: sql<number>`count(${validationFindings.overrideReason})::int`,
    })
    .from(validationFindings)
    .innerJoin(batches, eq(batches.batchId, validationFindings.batchId))
    .where(and(...conds))
    .groupBy(validationFindings.ruleId, validationFindings.severity)
    .orderBy(desc(sql`count(*)`), validationFindings.ruleId);
  const totalFindings = rows.reduce((a, r) => a + Number(r.findings), 0);
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(distinct ${validationFindings.batchId})::int` })
    .from(validationFindings)
    .innerJoin(batches, eq(batches.batchId, validationFindings.batchId))
    .where(and(...conds));
  return {
    items: rows.slice(0, limit).map((r) => ({ ruleId: r.ruleId, severity: r.severity as FindingSeverity, findings: Number(r.findings), rows: Number(r.rows), batches: Number(r.batches), overridden: Number(r.overridden) })),
    totalFindings,
    since,
    batches: Number(n),
  };
}

function startOfDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

/** Dashboard aggregates (docs/ux-design.md section 5.1). `scopeEmployerId` applies the Submitter scope. */
export async function getDashboardData(ctx: AppContext, scopeEmployerId: string | null): Promise<DashboardData> {
  const now = ctx.clock();
  const scope = scopeEmployerId ? eq(batches.employerId, scopeEmployerId) : undefined;
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const since60 = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const todayStart = startOfDayIso(now);

  const [[today], [inProg], [pending], [cur], [prev]] = await Promise.all([
    ctx.db.select({ n: sql<number>`count(*)` }).from(batches).where(and(scope, gte(batches.receivedAt, todayStart))),
    ctx.db.select({ n: sql<number>`count(*)` }).from(batches).where(and(scope, inArray(batches.status, IN_PROGRESS))),
    ctx.db.select({ n: sql<number>`count(*)`, oldest: sql<string | null>`min(${batches.receivedAt})` }).from(batches).where(and(scope, eq(batches.status, "PENDING_APPROVAL"))),
    ctx.db.select({ rows: sql<number>`coalesce(sum(${batches.rowsTotal}),0)`, rejected: sql<number>`coalesce(sum(${batches.rowsRejected}),0)` }).from(batches).where(and(scope, gte(batches.receivedAt, since30))),
    ctx.db.select({ rows: sql<number>`coalesce(sum(${batches.rowsTotal}),0)`, rejected: sql<number>`coalesce(sum(${batches.rowsRejected}),0)` }).from(batches).where(and(scope, gte(batches.receivedAt, since60), lt(batches.receivedAt, since30))),
  ]);

  const rows30d = Number(cur.rows);
  const rejectedRows30d = Number(cur.rejected);
  const rowsPrev = Number(prev.rows);

  const attentionRows = await ctx.db
    .select({ b: batches, filename: rawFiles.originalFilename })
    .from(batches)
    .innerJoin(rawFiles, eq(rawFiles.rawFileId, batches.rawFileId))
    .where(and(scope, gte(batches.receivedAt, since7), inArray(batches.status, ATTENTION)))
    .orderBy(desc(batches.batchId))
    .limit(10);

  const recentRows = await ctx.db
    .select({ b: batches, filename: rawFiles.originalFilename })
    .from(batches)
    .innerJoin(rawFiles, eq(rawFiles.rawFileId, batches.rawFileId))
    .where(scope)
    .orderBy(desc(batches.batchId))
    .limit(10);

  const toSummary = (r: { b: typeof batches.$inferSelect; filename: string }): BatchSummary => ({ ...toBatch(r.b), originalFilename: r.filename });

  return {
    kpis: {
      batchesToday: Number(today.n),
      inProgress: Number(inProg.n),
      pendingApproval: Number(pending.n),
      oldestPendingAt: pending.oldest ? new Date(pending.oldest).toISOString() : null,
      rejectionRate30d: rows30d > 0 ? rejectedRows30d / rows30d : null,
      rejectedRows30d,
      rows30d,
      rejectionRatePrev30d: rowsPrev > 0 ? Number(prev.rejected) / rowsPrev : null,
    },
    needsAttention: attentionRows.map(toSummary),
    recent: recentRows.map(toSummary),
    generatedAt: now.toISOString(),
  };
}