import Decimal from "decimal.js";
import type { FileDerived } from "@/lib/derivation/provisional";
import type { ArielContributionTx, ArielEmployment, ArielSalaryRate, ArielServiceTx, DecimalString, IsoDate } from "@/types";
import { daysInYear, yearOf } from "./dates";

export interface ServiceLike {
  type: string;
  amount: DecimalString;
  beginDate: IsoDate;
  targetDate: IsoDate;
  indicator: string;
  summaryAttribute: string;
  source: "ariel" | "file";
}
export interface ContributionLike extends ServiceLike {
  paymentDate: IsoDate;
}
export interface SalaryRateLike {
  type: string;
  rate: DecimalString;
  effectiveDate: IsoDate;
  source: "ariel" | "file";
}

/** Ariel transactions of the matched employment plus the file-derived ones (architecture "Ariel + FileDerived"). */
export interface TxView {
  service: ServiceLike[];
  contributions: ContributionLike[];
  salaryRates: SalaryRateLike[];
}

export function txView(emp: ArielEmployment, derived: FileDerived | null, includeFile = true): TxView {
  const service: ServiceLike[] = emp.service.map((t: ArielServiceTx) => ({ ...t, source: "ariel" as const }));
  const contributions: ContributionLike[] = emp.contributions.map((t: ArielContributionTx) => ({ ...t, source: "ariel" as const }));
  const salaryRates: SalaryRateLike[] = emp.salaryRates.map((t: ArielSalaryRate) => ({ type: t.type, rate: t.rate, effectiveDate: t.effectiveDate, source: "ariel" as const }));
  if (derived && includeFile) {
    for (const s of [derived.current, derived.previous]) {
      if (s.service) service.push({ ...s.service, source: "file" });
      for (const c of s.contributions) contributions.push({ ...c, source: "file" });
      if (s.salaryRate) salaryRates.push({ type: "REPORT", rate: String(s.salaryRate.rate), effectiveDate: s.salaryRate.effectiveDate, source: "file" });
    }
  }
  return { service, contributions, salaryRates };
}

export const ZERO = new Decimal(0);

export function sum(values: Iterable<DecimalString>): Decimal {
  let acc = ZERO;
  for (const v of values) acc = acc.plus(v);
  return acc;
}

/** RS: CTSRV with Year(targetDate) = year; REGUL excluded unless the rule says otherwise (B185/B186). */
export function reportedService(view: TxView, year: number, opts: { includeRegul?: boolean } = {}): Decimal {
  return sum(view.service.filter((t) => t.type === "CTSRV" && yearOf(t.targetDate) === year && (opts.includeRegul || t.indicator !== "REGUL")).map((t) => t.amount));
}

/** Ariel-only CTSRV already posted for the year (auto-correct hint "{3} - Ariel.Service"). */
export function arielService(view: TxView, year: number, opts: { includeRegul?: boolean } = {}): Decimal {
  return sum(view.service.filter((t) => t.source === "ariel" && t.type === "CTSRV" && yearOf(t.targetDate) === year && (opts.includeRegul || t.indicator !== "REGUL")).map((t) => t.amount));
}

export type Rounding = "UP" | "DOWN";

/** ES = ROUNDUP/ROUNDDOWN((TotalDays / TotalYear) * 52, 2). */
export function expectedService(totalDays: number, totalYear: number, rounding: Rounding): Decimal {
  if (totalYear <= 0) return ZERO;
  const raw = new Decimal(Math.max(0, totalDays)).div(totalYear).times(52);
  return raw.toDecimalPlaces(2, rounding === "UP" ? Decimal.ROUND_UP : Decimal.ROUND_DOWN);
}

export function totalYearDays(year: number): number {
  return daysInYear(year);
}

export function weeks(d: Decimal): string {
  return d.toFixed(2);
}