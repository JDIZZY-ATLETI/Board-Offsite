import type { eventsRecords } from "@/lib/db/schema";
import type { EventsRecord, IsoDate } from "@/types";

type RecordRow = typeof eventsRecords.$inferSelect;

/** Rehydrates the in-memory record from its persisted row; the raw SIN is never restored (sin: null). */
export function recordFromRow(record: RecordRow): EventsRecord {
  return {
    recordId: record.recordId,
    batchId: record.batchId,
    lineNumber: record.lineNumber,
    sin: null,
    sinPseudo: record.sinPseudo,
    sinMasked: record.sinMasked,
    lastName: record.lastName,
    firstName: record.firstName,
    eventType: (record.eventType as EventsRecord["eventType"]) ?? null,
    employmentEndDate: (record.employmentEndDate as IsoDate | null) ?? null,
    dateOfDeath: (record.dateOfDeath as IsoDate | null) ?? null,
    currentYear: { weeks: record.cyWeeks, lowContributions: record.cyLow, highContributions: record.cyHigh, annualizedEarnings: record.cyAe, pa: record.cyPa },
    previousYear: { weeks: record.pyWeeks, lowContributions: record.pyLow, highContributions: record.pyHigh, annualizedEarnings: record.pyAe, pa: record.pyPa },
    eventYear: record.eventYear ?? undefined,
    eventDate: ((record.eventType === "DECFIN" ? (record.dateOfDeath ?? record.employmentEndDate) : record.employmentEndDate) as IsoDate | null) ?? undefined,
    rawValues: record.rawValues as EventsRecord["rawValues"],
    extraValues: [],
  };
}