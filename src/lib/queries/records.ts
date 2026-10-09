import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { eventsRecords } from "@/lib/db/schema";
import type { EventType, IsoDate, RecordOutcome } from "@/types";
import { findingCountsByRecord } from "./findings";

export interface RecordSummary {
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  lastName: string | null;
  firstName: string | null;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  parseOk: boolean;
  outcome: RecordOutcome | "PENDING";
  findingCounts: { cme: number; warning: number; info: number };
  rawValues: Record<string, string | null>;
}

export interface ListRecordsParams {
  accepted?: "true" | "false" | "held";
  cursor?: string | null;
  limit?: number;
}

export async function listRecords(ctx: AppContext, batchId: string, p: ListRecordsParams): Promise<{ items: RecordSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const conds = [eq(eventsRecords.batchId, batchId)];
  if (p.accepted === "true") conds.push(eq(eventsRecords.accepted, true));
  else if (p.accepted === "false") conds.push(eq(eventsRecords.accepted, false));
  else if (p.accepted === "held") conds.push(isNull(eventsRecords.accepted));
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
      lastName: r.lastName,
      firstName: r.firstName,
      eventType: et,
      eventDate: eventDate ?? null,
      parseOk: r.parseOk,
      outcome: r.accepted === null ? "PENDING" : r.accepted ? "ACCEPTED" : "REJECTED",
      findingCounts: counts.get(r.recordId) ?? { cme: 0, warning: 0, info: 0 },
      rawValues: r.rawValues,
    };
  });
  return { items, nextCursor: rows.length > limit ? String(items[items.length - 1].lineNumber) : null };
}
