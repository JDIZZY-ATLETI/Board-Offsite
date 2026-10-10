import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { eventsRecords } from "@/lib/db/schema";
import type { EventType, IsoDate, RecordOutcome } from "@/types";
import { findingCountsByRecord } from "./findings";

/** Parsed (typed) values per year block; null = blank or unparseable (the raw value is in `rawValues`). */
export interface ParsedYearBlock {
  weeks: string | null;
  lowContributions: string | null;
  highContributions: string | null;
  annualizedEarnings: number | null;
  pa: number | null;
}

export interface RecordSummary {
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  sinPseudo: string | null;
  lastName: string | null;
  firstName: string | null;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  parseOk: boolean;
  outcome: RecordOutcome | "PENDING";
  findingCounts: { cme: number; warning: number; info: number };
  rawValues: Record<string, string | null>;
  parsed: {
    employmentEndDate: IsoDate | null;
    dateOfDeath: IsoDate | null;
    currentYear: ParsedYearBlock;
    previousYear: ParsedYearBlock;
  };
}

export interface ListRecordsParams {
  accepted?: "true" | "false" | "held";
  cursor?: string | null;
  limit?: number;
}

export async function listRecords(ctx: AppContext, batchId: string, p: ListRecordsParams): Promise<{ items: RecordSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const conds = [eq(eventsRecords.batchId, batchId)];
  if (p.accepted === "true") conds.push(eq(eventsRecords.outcome, "ACCEPTED"));
  else if (p.accepted === "false") conds.push(eq(eventsRecords.outcome, "REJECTED"));
  else if (p.accepted === "held") conds.push(eq(eventsRecords.outcome, "HELD"));
  if (p.cursor) conds.push(gt(eventsRecords.lineNumber, Number(p.cursor)));
  const rows = await ctx.db
    .select()
    .from(eventsRecords)
    .where(and(...conds))
    .orderBy(asc(eventsRecords.lineNumber))
    .limit(limit + 1);
  const counts = await findingCountsByRecord(ctx, batchId);
  const items: RecordSummary[] = rows.slice(0, limit).map((r) => {
    const et = (r.eventType as EventType | null) ?? null;
    const eventDate = (et === "DECFIN" ? r.dateOfDeath : r.employmentEndDate) as IsoDate | null;
    return {
      recordId: r.recordId,
      lineNumber: r.lineNumber,
      sinMasked: r.sinMasked,
      sinPseudo: r.sinPseudo,
      lastName: r.lastName,
      firstName: r.firstName,
      eventType: et,
      eventDate: eventDate ?? null,
      parseOk: r.parseOk,
      outcome: (r.outcome as RecordOutcome | null) ?? (r.accepted === null ? "PENDING" : r.accepted ? "ACCEPTED" : "REJECTED"),
      findingCounts: counts.get(r.recordId) ?? { cme: 0, warning: 0, info: 0 },
      rawValues: r.rawValues,
      parsed: {
        employmentEndDate: (r.employmentEndDate as IsoDate | null) ?? null,
        dateOfDeath: (r.dateOfDeath as IsoDate | null) ?? null,
        currentYear: { weeks: r.cyWeeks, lowContributions: r.cyLow, highContributions: r.cyHigh, annualizedEarnings: r.cyAe, pa: r.cyPa },
        previousYear: { weeks: r.pyWeeks, lowContributions: r.pyLow, highContributions: r.pyHigh, annualizedEarnings: r.pyAe, pa: r.pyPa },
      },
    };
  });
  return { items, nextCursor: rows.length > limit ? String(items[items.length - 1].lineNumber) : null };
}

/** Outcome counts for the Records facet / Overview panel. */
export async function recordOutcomeCounts(ctx: AppContext, batchId: string): Promise<{ accepted: number; rejected: number; held: number; pending: number; byEventType: Array<{ eventType: string; rows: number; accepted: number; rejected: number; held: number }> }> {
  const rows = await ctx.db.select({ eventType: eventsRecords.eventType, accepted: eventsRecords.accepted, outcome: eventsRecords.outcome }).from(eventsRecords).where(eq(eventsRecords.batchId, batchId));
  const out = { accepted: 0, rejected: 0, held: 0, pending: 0, byEventType: [] as Array<{ eventType: string; rows: number; accepted: number; rejected: number; held: number }> };
  const m = new Map<string, { eventType: string; rows: number; accepted: number; rejected: number; held: number }>();
  for (const r of rows) {
    const outcome = (r.outcome as RecordOutcome | null) ?? (r.accepted === null ? null : r.accepted ? "ACCEPTED" : "REJECTED");
    if (outcome === null) out.pending += 1;
    else if (outcome === "ACCEPTED") out.accepted += 1;
    else if (outcome === "HELD") out.held += 1;
    else out.rejected += 1;
    const key = r.eventType ?? "(invalid)";
    const e = m.get(key) ?? { eventType: key, rows: 0, accepted: 0, rejected: 0, held: 0 };
    e.rows += 1;
    if (outcome === "ACCEPTED") e.accepted += 1;
    else if (outcome === "REJECTED") e.rejected += 1;
    else if (outcome === "HELD") e.held += 1;
    m.set(key, e);
  }
  out.byEventType = [...m.values()].sort((a, b) => b.rows - a.rows);
  return out;
}

export interface RecordLite {
  lineNumber: number;
  sinMasked: string | null;
  sinPseudo: string | null;
  firstName: string | null;
  lastName: string | null;
  eventType: string | null;
  eventDate: string | null;
  /** Row outcome so the Findings tab can offer Override only on HELD rows (GAP-OVR-1). */
  outcome: RecordOutcome | "PENDING";
}

/** Member facts for a set of line numbers (Findings tab headers). */
export async function recordsByLineNumbers(ctx: AppContext, batchId: string, lines: number[]): Promise<Record<number, RecordLite>> {
  const unique = [...new Set(lines)].filter((n) => Number.isInteger(n) && n > 0);
  if (unique.length === 0) return {};
  const rows = await ctx.db
    .select({ lineNumber: eventsRecords.lineNumber, sinMasked: eventsRecords.sinMasked, sinPseudo: eventsRecords.sinPseudo, firstName: eventsRecords.firstName, lastName: eventsRecords.lastName, eventType: eventsRecords.eventType, employmentEndDate: eventsRecords.employmentEndDate, dateOfDeath: eventsRecords.dateOfDeath, outcome: eventsRecords.outcome, accepted: eventsRecords.accepted })
    .from(eventsRecords)
    .where(and(eq(eventsRecords.batchId, batchId), inArray(eventsRecords.lineNumber, unique)));
  const out: Record<number, RecordLite> = {};
  for (const r of rows) {
    const outcome = (r.outcome as RecordOutcome | null) ?? (r.accepted === null ? "PENDING" : r.accepted ? "ACCEPTED" : "REJECTED");
    out[r.lineNumber] = { lineNumber: r.lineNumber, sinMasked: r.sinMasked, sinPseudo: r.sinPseudo, firstName: r.firstName, lastName: r.lastName, eventType: r.eventType, eventDate: (r.eventType === "DECFIN" ? r.dateOfDeath : r.employmentEndDate) ?? null, outcome };
  }
  return out;
}