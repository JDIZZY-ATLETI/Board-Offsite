import Decimal from "decimal.js";
import { InMemoryArielSnapshot } from "@/lib/ariel/snapshot";
import { calculatedPA } from "@/lib/rules/lib/ae";
import { placeholderRateRows, StaticRateTables } from "@/lib/ariel/rates";
import { maskSin, pseudonymizeSin } from "@/lib/pii/sin";
import type { ArielContributionTx, ArielEmployment, ArielMemberSnapshot, ArielSalaryRate, ArielServiceBreak, ArielServiceTx, DecimalString, IsoDate, RawValues } from "@/types";
import { VALID_TERFIN } from "./fixtures";

/** Same pseudonym key as `rec()` so fixture members match fixture records. */
export const KEY = Buffer.from("a1".repeat(32), "hex");
export const RATES = new StaticRateTables(placeholderRateRows());
export const SUMMARY_MDC = "MDC – Core Data";

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function ctsrv(year: number, weeks: DecimalString | number, over: Partial<ArielServiceTx> = {}): ArielServiceTx {
  return { txId: id("svc"), type: "CTSRV", amount: typeof weeks === "number" ? weeks.toFixed(4) : weeks, beginDate: `${year}-01-01` as IsoDate, endDate: `${year}-12-31` as IsoDate, paymentDate: `${year}-12-31` as IsoDate, targetDate: `${year}-12-31` as IsoDate, declarationDate: null, indicator: "PRV", summaryAttribute: SUMMARY_MDC, ...over };
}

export function contrib(year: number, type: ArielContributionTx["type"], amount: DecimalString | number, over: Partial<ArielContributionTx> = {}): ArielContributionTx {
  return { txId: id("ctb"), type, amount: typeof amount === "number" ? amount.toFixed(2) : amount, beginDate: `${year}-01-01` as IsoDate, endDate: `${year}-12-31` as IsoDate, paymentDate: `${year}-12-31` as IsoDate, targetDate: `${year}-12-31` as IsoDate, declarationDate: null, indicator: "PRV", summaryAttribute: SUMMARY_MDC, ...over };
}

export function salaryRate(year: number, rate: number, over: Partial<ArielSalaryRate> = {}): ArielSalaryRate {
  return { txId: id("sal"), type: "REPORT", rate: rate.toFixed(2), effectiveDate: `${year}-01-01` as IsoDate, entryDate: null, indicator: "PRV", summaryAttribute: SUMMARY_MDC, ...over };
}

export function brk(type: string, startDate: IsoDate, endDate: IsoDate | null = null): ArielServiceBreak {
  return { breakId: id("brk"), type, startDate, endDate };
}

/** A year of full-time MDC data: 52 weeks, contributions consistent with the given annualised earnings. */
export function mdcYear(year: number, ae: number, weeks = 52): { service: ArielServiceTx; low: ArielContributionTx; high: ArielContributionTx } {
  const ympe = Number(RATES.ympe(year));
  const lowBase = Math.min(ae, ympe) * (weeks / 52);
  const highBase = Math.max(0, ae - ympe) * (weeks / 52);
  return { service: ctsrv(year, weeks), low: contrib(year, "RPPLOW", +(lowBase * 0.069).toFixed(2)), high: contrib(year, "RPPHGH", +(highBase * 0.092).toFixed(2)) };
}

export function employment(over: Partial<ArielEmployment> = {}): ArielEmployment {
  return {
    employmentId: id("emp"),
    employerId: "0235",
    permanencyDate: "2015-03-02",
    terminationDate: null,
    terminationCode: null,
    lastAnnualDataUpdate: "2025-12-31",
    otherInformation: null,
    employmentType: "FT",
    terminationDataUpdate: null,
    employmentTypeHistory: [],
    serviceBreaks: [],
    service: [],
    contributions: [],
    salaryRates: [],
    ...over,
  };
}

export interface MemberOptions extends Partial<Omit<ArielMemberSnapshot, "membership" | "employments">> {
  sin?: string;
  membership?: Partial<ArielMemberSnapshot["membership"]>;
  employments?: ArielEmployment[];
  /** Shorthand: overrides applied to a single default employment. */
  emp?: Partial<ArielEmployment>;
}

/** Member matching `rec()`'s default SIN unless `sin` is given. */
export function member(o: MemberOptions = {}): ArielMemberSnapshot {
  const sin = o.sin ?? VALID_TERFIN.SIN;
  const { sin: _s, membership, employments, emp, ...rest } = o;
  void _s;
  return {
    memberId: id("mbr"),
    sinPseudo: pseudonymizeSin(KEY, sin),
    sinMasked: maskSin(sin),
    lastName: "ABLE",
    firstName: "Anna",
    dateOfBirth: "1985-04-12",
    dateOfDeath: null,
    membership: { status: "A", subStatus: null, statusEffectiveDate: "2015-03-02", subStatusEffectiveDate: null, calculationIndicators: [], statusHistory: [{ status: "A", subStatus: null, effectiveDate: "2015-03-02" }], ...membership },
    employments: employments ?? [employment(emp)],
    pensionAdjustments: [],
    addresses: [{ effectiveStartDate: "2015-03-02" }],
    ...rest,
  };
}

export function snapshotOf(members: ArielMemberSnapshot[], batchId = "00000000-0000-7000-8000-000000000000", employerId = "0235"): InMemoryArielSnapshot {
  return new InMemoryArielSnapshot(members, { adapter: "FixtureAdapter", batchId, employerId, requested: members.length, found: members.length });
}
// ---- consistent file blocks + members (same arithmetic as tests/golden/generate-fixtures.ts) ----

export const mmdd = (iso: IsoDate): string => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;

/** Low/high contributions consistent with annualised earnings `ae` over `weeks` of service in `year`. */
export function contribsFor(year: number, ae: number, weeks: number): { low: string; high: string } {
  const ympe = Number(RATES.ympe(year));
  const f = weeks / 52;
  return { low: (Math.min(ae, ympe) * 0.069 * f).toFixed(2), high: (Math.max(0, ae - ympe) * 0.092 * f).toFixed(2) };
}

/** HOOPP-calculated PA (whole dollars) for the block - what B53a expects within +/-250. */
export function paFor(year: number, ae: number, weeks: number): string {
  return String(calculatedPA(new Decimal(ae), new Decimal(weeks).div(52), year, RATES)!.toDecimalPlaces(0).toNumber());
}

/** A clean current-year block with a blank previous year; passes every L2 rule for `stdMember()`. */
export function cyBlock(eventDate: IsoDate, weeks: number, ae: number, over: Partial<RawValues> = {}): Partial<RawValues> {
  const year = Number(eventDate.slice(0, 4));
  const c = contribsFor(year, ae, weeks);
  return {
    EmploymentEndDate: mmdd(eventDate),
    Weeks_CurrentYear: weeks.toFixed(2),
    LowContributions_CurrentYear: c.low,
    HighContributions_CurrentYear: Number(c.high) > 0 ? c.high : "",
    AnnualizedEarnings_CurrentYear: "",
    PA_CurrentYear: paFor(year, ae, weeks),
    Weeks_PreviousYear: "",
    LowContributions_PreviousYear: "",
    HighContributions_PreviousYear: "",
    AnnualizedEarnings_PreviousYear: "",
    PA_PreviousYear: "",
    ...over,
  };
}

/** A consistent previous-year block for `year`. */
export function pyBlock(year: number, weeks: number, ae: number, over: Partial<RawValues> = {}): Partial<RawValues> {
  const c = contribsFor(year, ae, weeks);
  return { Weeks_PreviousYear: weeks.toFixed(2), LowContributions_PreviousYear: c.low, HighContributions_PreviousYear: Number(c.high) > 0 ? c.high : "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: paFor(year, ae, weeks), ...over };
}

export const ZERO_CY: Partial<RawValues> = { Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00", HighContributions_CurrentYear: "", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: "0" };
export const ZERO_PY: Partial<RawValues> = { Weeks_PreviousYear: "0.00", LowContributions_PreviousYear: "0.00", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "0" };

export interface MdcYearSpec {
  year: number;
  ae: number;
  weeks?: number;
}
export const STD_YEARS: MdcYearSpec[] = [
  { year: 2024, ae: 72000 },
  { year: 2025, ae: 75000 },
];

/** MDC Core Data service + contributions for the given years (what the annual collect posted to Ariel). */
export function mdcHistory(years: MdcYearSpec[] = STD_YEARS): { service: ArielServiceTx[]; contributions: ArielContributionTx[] } {
  const service: ArielServiceTx[] = [];
  const contributions: ArielContributionTx[] = [];
  for (const y of years) {
    const m = mdcYear(y.year, y.ae, y.weeks ?? 52);
    service.push(m.service);
    contributions.push(m.low);
    if (Number(m.high.amount) > 0) contributions.push(m.high);
  }
  return { service, contributions };
}

/** Full-time member enrolled 2015-03-02 at 0235 with 2024 + 2025 MDC history (architecture section 4.6 M1 shape). */
export function stdMember(o: MemberOptions = {}, years: MdcYearSpec[] = STD_YEARS): ArielMemberSnapshot {
  const h = mdcHistory(years);
  return member({ ...o, emp: { service: h.service, contributions: h.contributions, ...o.emp } });
}
