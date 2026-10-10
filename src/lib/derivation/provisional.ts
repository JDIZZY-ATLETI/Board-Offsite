import Decimal from "decimal.js";
import type { ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import { dec31, jan1, maxDate, yearOf } from "@/lib/rules/lib/dates";
import type { ArielEmployment, ArielMemberSnapshot, DecimalString, EventsRecord, IsoDate, YearScope } from "@/types";

/**
 * Provisional derivation (architecture section 8.1 / 8.7-8.10 in "provisional" mode): the would-be Ariel
 * transactions the L2 rules inspect. Pure function of (record, snapshot, executionDate).
 */
export const SUMMARY_FINAL_DATA = "Final Data - Events";

export interface DerivedServiceTx {
  type: "CTSRV";
  amount: DecimalString;
  beginDate: IsoDate;
  endDate: IsoDate;
  paymentDate: IsoDate;
  targetDate: IsoDate;
  indicator: "PRV";
  summaryAttribute: string;
}

export interface DerivedContributionTx {
  type: "RPPLOW" | "RPPHGH";
  amount: DecimalString;
  beginDate: IsoDate;
  endDate: IsoDate;
  paymentDate: IsoDate;
  targetDate: IsoDate;
  indicator: "PRV";
  summaryAttribute: string;
}

export interface ScopeDerived {
  scope: YearScope;
  year: number;
  begin: IsoDate;
  end: IsoDate;
  paymentDate: IsoDate;
  targetDate: IsoDate;
  declarationDate: IsoDate;
  /** CTSRV item (only when Weeks is non-null and non-zero). */
  service: DerivedServiceTx | null;
  /** PRV contribution items (RPPLOW when Low non-null; RPPHGH when High non-null). */
  contributions: DerivedContributionTx[];
  /** REPORT salary rate when AE > 0. */
  salaryRate: { rate: number; effectiveDate: IsoDate } | null;
  /** PA item when PA non-null (0 is recorded). */
  pa: { amount: number; calculationYear: number; entryDate: IsoDate } | null;
  /** True when at least one file field in this block is non-null. */
  present: boolean;
}

export interface DerivedMembershipStatus {
  status: "D";
  subStatus: "NCT";
  statusEffectiveDate: IsoDate;
  subStatusEffectiveDate: IsoDate;
}

export interface FileDerived {
  member: ArielMemberSnapshot;
  employment: ArielEmployment;
  eventDate: IsoDate;
  eventYear: number;
  executionDate: IsoDate;
  current: ScopeDerived;
  previous: ScopeDerived;
  /** Section 8.3: only TERFIN/DECFIN closing the last open employment. */
  membershipStatus: DerivedMembershipStatus | null;
  isLastOpenEmployment: boolean;
  /** Architecture section 18 Q17. */
  statusEventDate: IsoDate;
}

/** Most recent employment at the reporting employer (by permanency date, then id for stability). */
export function employmentFor(member: ArielMemberSnapshot, employerId: string): ArielEmployment | null {
  const list = member.employments.filter((e) => e.employerId === employerId);
  if (list.length === 0) return null;
  return [...list].sort((a, b) => b.permanencyDate.localeCompare(a.permanencyDate) || a.employmentId.localeCompare(b.employmentId))[0];
}

export function scopeOf(record: EventsRecord, scope: YearScope) {
  return scope === "CURRENT" ? record.currentYear : record.previousYear;
}

function nonZero(v: DecimalString | null | undefined): v is DecimalString {
  return typeof v === "string" && !new Decimal(v).isZero();
}

function buildScope(record: EventsRecord, emp: ArielEmployment, eventDate: IsoDate, eventYear: number, executionDate: IsoDate, scope: YearScope, employerId: string): ScopeDerived {
  const block = scopeOf(record, scope);
  const year = scope === "CURRENT" ? eventYear : eventYear - 1;
  const begin = maxDate(jan1(year), emp.permanencyDate);
  const end = scope === "CURRENT" ? eventDate : dec31(year);
  const target = end;
  const common = { beginDate: begin, endDate: end, paymentDate: target, targetDate: target, indicator: "PRV" as const, summaryAttribute: SUMMARY_FINAL_DATA };
  const contributions: DerivedContributionTx[] = [];
  if (typeof block.lowContributions === "string") contributions.push({ type: "RPPLOW", amount: new Decimal(block.lowContributions).toFixed(2), ...common });
  if (typeof block.highContributions === "string") contributions.push({ type: "RPPHGH", amount: new Decimal(block.highContributions).toFixed(2), ...common });
  const present = [block.weeks, block.lowContributions, block.highContributions, block.annualizedEarnings, block.pa].some((v) => v !== null && v !== undefined);
  void employerId;
  return {
    scope,
    year,
    begin,
    end,
    paymentDate: target,
    targetDate: target,
    declarationDate: target,
    service: nonZero(block.weeks) ? { type: "CTSRV", amount: new Decimal(block.weeks).toFixed(2), ...common } : null,
    contributions,
    salaryRate: typeof block.annualizedEarnings === "number" && block.annualizedEarnings > 0 ? { rate: block.annualizedEarnings, effectiveDate: begin } : null,
    pa: typeof block.pa === "number" ? { amount: block.pa, calculationYear: year, entryDate: executionDate } : null,
    present,
  };
}

/** Returns null when the SIN is unknown, the member has no employment at the employer, or there is no event date. */
export function deriveProvisional(record: EventsRecord, ariel: ArielBatchSnapshot, employerId: string, executionDate: IsoDate): FileDerived | null {
  if (!record.sinPseudo || !record.eventDate || !record.eventType) return null;
  const member = ariel.memberBySin(record.sinPseudo);
  if (!member) return null;
  const employment = employmentFor(member, employerId);
  if (!employment) return null;
  const eventDate = record.eventDate;
  const eventYear = yearOf(eventDate);
  const others = member.employments.filter((e) => e.employmentId !== employment.employmentId);
  const isLastOpenEmployment = others.every((e) => e.terminationDate !== null);
  const statusEventDate = maxDate(eventDate, ...others.map((e) => e.terminationDate).filter((d): d is IsoDate => d !== null));
  const closes = record.eventType === "TERFIN" || record.eventType === "DECFIN";
  return {
    member,
    employment,
    eventDate,
    eventYear,
    executionDate,
    current: buildScope(record, employment, eventDate, eventYear, executionDate, "CURRENT", employerId),
    previous: buildScope(record, employment, eventDate, eventYear, executionDate, "PREVIOUS", employerId),
    membershipStatus: closes && isLastOpenEmployment ? { status: "D", subStatus: "NCT", statusEffectiveDate: statusEventDate, subStatusEffectiveDate: statusEventDate } : null,
    isLastOpenEmployment,
    statusEventDate,
  };
}

export function derivedScope(d: FileDerived, scope: YearScope): ScopeDerived {
  return scope === "CURRENT" ? d.current : d.previous;
}

/** Service + contribution items across both scopes (B223 reads their target dates). */
export function derivedTransactions(d: FileDerived): Array<DerivedServiceTx | DerivedContributionTx> {
  const out: Array<DerivedServiceTx | DerivedContributionTx> = [];
  for (const s of [d.current, d.previous]) {
    if (s.service) out.push(s.service);
    out.push(...s.contributions);
  }
  return out;
}