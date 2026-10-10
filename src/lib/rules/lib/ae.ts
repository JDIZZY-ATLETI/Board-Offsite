import Decimal from "decimal.js";
import type { ArielRateTables } from "@/types";
import { yearOf } from "./dates";
import { sum, ZERO, type ContributionLike, type TxView } from "./service";

export type AeVariant = "standard" | "retroPaid" | "withRetro";

const RETRO_ATTRS = new Set(["RRETRO", "FRETRO"]);

function lowFilter(c: ContributionLike): boolean {
  return c.type === "RPPLOW" && c.indicator !== "REGUL";
}
function highFilter(c: ContributionLike): boolean {
  return (c.type === "RPPHGH" || c.type === "RCAHGH") && c.indicator !== "REGUL";
}

function pool(view: TxView, year: number, variant: AeVariant, pick: (c: ContributionLike) => boolean): Decimal {
  const rows = view.contributions.filter(pick);
  switch (variant) {
    case "standard":
      return sum(rows.filter((c) => yearOf(c.beginDate) === year && c.summaryAttribute !== "RRETRO").map((c) => c.amount));
    case "withRetro":
      return sum(rows.filter((c) => yearOf(c.beginDate) === year).map((c) => c.amount));
    case "retroPaid":
      return sum(rows.filter((c) => !RETRO_ATTRS.has(c.summaryAttribute) && yearOf(c.beginDate) === year).map((c) => c.amount)).plus(
        sum(rows.filter((c) => RETRO_ATTRS.has(c.summaryAttribute) && yearOf(c.paymentDate) === year).map((c) => c.amount)),
      );
  }
}

export interface AeResult {
  ae: Decimal;
  source: "REPORT" | "CALCULATED" | "NONE";
  service: Decimal;
  low: Decimal;
  high: Decimal;
}

/**
 * Spec "Function CalculateAE / CalculateAEwithRetroPaid / CalculateAEwithRetro" (B40-B47, B53). A REPORT salary
 * rate for the year wins; otherwise contributions grossed up by rate and annualised over service/52.
 */
export function calculateAE(view: TxView, year: number, rates: ArielRateTables, variant: AeVariant = "standard"): AeResult {
  const report = view.salaryRates.filter((s) => s.type === "REPORT" && yearOf(s.effectiveDate) === year).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  if (report) return { ae: new Decimal(report.rate), source: "REPORT", service: ZERO, low: ZERO, high: ZERO };
  const service = sum(view.service.filter((t) => t.type === "CTSRV" && t.indicator !== "REGUL" && yearOf(t.beginDate) === year).map((t) => t.amount));
  if (service.isZero()) return { ae: ZERO, source: "NONE", service, low: ZERO, high: ZERO };
  const low = pool(view, year, variant, lowFilter);
  const high = pool(view, year, variant, highFilter);
  const ae = low.div(rates.lowContributionRate(year)).plus(high.div(rates.highContributionRate(year))).div(service.div(52));
  return { ae: ae.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), source: "CALCULATED", service, low, high };
}

/** Low-contribution ceiling pieces shared by B37/B38. */
export function lowContributionCalc(weeks: Decimal, year: number, rates: ArielRateTables): { calc: Decimal; maxWeekly: Decimal } {
  const annual = new Decimal(rates.ympe(year)).times(rates.lowContributionRate(year));
  return { calc: annual.times(weeks).div(52), maxWeekly: annual.div(52) };
}

/** B53a/B53b Calculated PA (architecture section 7.9.3 #33). */
export function calculatedPA(ae: Decimal, svc: Decimal, year: number, rates: ArielRateTables): Decimal {
  const ympe = new Decimal(rates.ympe(year));
  const cap = new Decimal(rates.paMaxDb(year)).times(svc);
  const over = Decimal.max(0, ae.minus(ympe)).times(0.02).times(svc);
  const under = Decimal.min(ae, ympe).times(0.015).times(svc);
  const formula = over.plus(under).times(9).minus(new Decimal(rates.paOffset(year)).times(svc));
  return Decimal.min(cap, formula).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}