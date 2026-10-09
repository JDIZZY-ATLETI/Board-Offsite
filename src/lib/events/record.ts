import { EVENT_TYPES, type EventsRecord, type EventType, type IsoDate, type RawEventsRow, type YearBlock, type DecimalString } from "@/types";
import { normalizeSin, sinIdentity } from "@/lib/pii/sin";
import { isBlank, parseDateField, parseDecimalField, parseIntegerField, yearOf } from "./fields";

export interface RecordBuildContext {
  batchId: string;
  pseudonymKey: Buffer;
  newId: () => string;
}

function dec(raw: string | null | undefined): DecimalString | null | undefined {
  if (isBlank(raw)) return null;
  const r = parseDecimalField(raw);
  return r.ok ? r.value : undefined;
}

function int(raw: string | null | undefined): number | null | undefined {
  if (isBlank(raw)) return null;
  const r = parseIntegerField(raw);
  return r.ok ? r.value : undefined;
}

function date(raw: string | null | undefined): IsoDate | null | undefined {
  if (isBlank(raw)) return null;
  const r = parseDateField(raw);
  return r.ok ? r.value : undefined;
}

function eventType(raw: string | null | undefined): EventType | null | undefined {
  if (isBlank(raw)) return null;
  const t = raw.trim();
  return (EVENT_TYPES as readonly string[]).includes(t) ? (t as EventType) : undefined;
}

function text(raw: string | null | undefined): string | null {
  return isBlank(raw) ? null : raw.trim();
}

/** Builds the typed canonical record. Format failures become `undefined` fields; L1 rules explain why. */
export function buildRecord(row: RawEventsRow, ctx: RecordBuildContext): EventsRecord {
  const v = row.values;
  const sin = normalizeSin(v.SIN);
  const identity = sin ? sinIdentity(ctx.pseudonymKey, sin) : null;
  const et = eventType(v.EventType);
  const eed = date(v.EmploymentEndDate);
  const dodRaw = date(v.DateOfDeath);
  // Architecture section 18 Q1: CSV DECFIN rows carry no DateOfDeath; EmploymentEndDate stands in.
  const dod: IsoDate | null | undefined = et === "DECFIN" ? (dodRaw ?? eed) : dodRaw;
  const eventDate: IsoDate | undefined = et === "DECFIN" ? (dod ?? undefined) : et ? (eed ?? undefined) : undefined;
  const currentYear: YearBlock = {
    weeks: dec(v.Weeks_CurrentYear),
    lowContributions: dec(v.LowContributions_CurrentYear),
    highContributions: dec(v.HighContributions_CurrentYear),
    annualizedEarnings: int(v.AnnualizedEarnings_CurrentYear),
    pa: int(v.PA_CurrentYear),
  };
  const previousYear: YearBlock = {
    weeks: dec(v.Weeks_PreviousYear),
    lowContributions: dec(v.LowContributions_PreviousYear),
    highContributions: dec(v.HighContributions_PreviousYear),
    annualizedEarnings: int(v.AnnualizedEarnings_PreviousYear),
    pa: int(v.PA_PreviousYear),
  };
  return {
    recordId: ctx.newId(),
    batchId: ctx.batchId,
    lineNumber: row.lineNumber,
    sin,
    sinPseudo: identity?.sinPseudo ?? null,
    sinMasked: identity?.sinMasked ?? null,
    lastName: text(v.LastName),
    firstName: text(v.FirstName),
    eventType: et,
    employmentEndDate: eed,
    dateOfDeath: dod,
    currentYear,
    previousYear,
    eventYear: eventDate ? yearOf(eventDate) : undefined,
    eventDate,
    rawValues: { ...v },
    extraValues: [...row.extraValues],
  };
}

/** True when every typed field parsed (blank is fine). */
export function recordParseOk(r: EventsRecord): boolean {
  const blocks = [r.currentYear, r.previousYear];
  if (r.eventType === undefined || r.employmentEndDate === undefined || r.dateOfDeath === undefined) return false;
  return blocks.every((b) => Object.values(b).every((x) => x !== undefined));
}

/** Copy of the raw values safe to persist or display: SIN is masked. */
export function maskedRawValues(r: EventsRecord): Record<string, string | null> {
  return { ...r.rawValues, SIN: r.sinMasked };
}
