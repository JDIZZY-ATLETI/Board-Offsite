import Decimal from "decimal.js";
import type { DecimalString } from "@/types";

/**
 * Architecture section 8.8 "Calculated (CLC) RPP/RCA split" - isolated so the sign convention (section 18 Q15)
 * and the PA fallback (Q14) are one-line changes. Pure: strings in, strings out, 2 dp, no rounding surprises.
 *
 *   Pool(Y)   = sum Ariel RPPLOW[PRV](Y) + sum Ariel RPPHGH[PRV](Y) + sum Ariel RETRO rows (Y) + File.Low + File.High
 *   Limit(Y)  = RPP_LIMIT_BASE + RPP_LIMIT_PA_FACTOR x PA_eff
 *   Excess(Y) = MAX(0, Pool - Limit)
 *   PriorCLC  = sum Ariel RPPHGH[CLC](Y)                 (signed; stored negative)
 *   RPPHGH_CLC = -Excess - PriorCLC
 *   RCAHGH_CLC = +Excess - PriorCLC
 */
export const RPP_LIMIT_BASE = new Decimal(1000);
export const RPP_LIMIT_PA_FACTOR = new Decimal("0.7");

export interface ContributionSplitInput {
  /** Year being calculated (CY = EventYear, PY = EventYear - 1). */
  year: number;
  arielLowPrv: DecimalString;
  arielHighPrv: DecimalString;
  arielLowRetro: DecimalString;
  arielHighRetro: DecimalString;
  fileLow: DecimalString;
  fileHigh: DecimalString;
  /** File PA for the scope (null when blank). */
  filePa: number | null;
  /** Ariel PA for the year at the reporting employer (null when none posted). */
  arielPa: number | null;
  /** sum Ariel RPPHGH[CLC](Y) - already posted split, signed. */
  priorRpphghClc: DecimalString;
}

export interface ContributionSplitResult {
  year: number;
  pool: DecimalString;
  paEffective: number;
  paSource: "file" | "ariel";
  limit: DecimalString;
  excess: DecimalString;
  priorClc: DecimalString;
  rpphghClc: DecimalString;
  rcahghClc: DecimalString;
  /** False when both amounts are 0.00 and no prior CLC exists: no items are produced (section 8.8). */
  emit: boolean;
  terms: {
    arielLowPrv: DecimalString;
    arielHighPrv: DecimalString;
    arielLowRetro: DecimalString;
    arielHighRetro: DecimalString;
    fileLow: DecimalString;
    fileHigh: DecimalString;
  };
  explanationRpp: string;
  explanationRca: string;
}

export function money(v: Decimal.Value): DecimalString {
  return new Decimal(v).toFixed(2);
}

/** Q14: File.PA when non-null and non-zero, else Ariel PA for the year; null when neither exists. */
export function effectivePa(filePa: number | null, arielPa: number | null): { value: number; source: "file" | "ariel" } | null {
  if (filePa !== null && filePa !== 0) return { value: filePa, source: "file" };
  if (arielPa !== null) return { value: arielPa, source: "ariel" };
  return null;
}

/** Returns null when no effective PA exists for the year (no CLC is calculated at all - Q14 point 3). */
export function computeContributionSplit(i: ContributionSplitInput): ContributionSplitResult | null {
  const pa = effectivePa(i.filePa, i.arielPa);
  if (!pa) return null;
  const d = (s: DecimalString) => new Decimal(s);
  const pool = d(i.arielLowPrv).plus(d(i.arielHighPrv)).plus(d(i.arielLowRetro)).plus(d(i.arielHighRetro)).plus(d(i.fileLow)).plus(d(i.fileHigh));
  const limit = RPP_LIMIT_BASE.plus(RPP_LIMIT_PA_FACTOR.times(pa.value));
  const excess = Decimal.max(0, pool.minus(limit));
  const prior = d(i.priorRpphghClc);
  // Q15: implemented literally - RPP calculated amount is the negative excess, RCA the positive mirror, both net of prior CLC.
  const rpp = excess.negated().minus(prior);
  const rca = excess.minus(prior);
  const emit = !(rpp.isZero() && rca.isZero() && prior.isZero());
  const poolText = `${money(i.arielLowPrv)} (Ariel RPPLOW PRV ${i.year}) + ${money(i.arielHighPrv)} (Ariel RPPHGH PRV ${i.year}) + ${money(d(i.arielLowRetro).plus(d(i.arielHighRetro)))} (Ariel RETRO ${i.year}) + ${money(i.fileLow)} (file Low) + ${money(i.fileHigh)} (file High) = ${money(pool)}`;
  const limitText = `${RPP_LIMIT_BASE.toFixed(0)} + ${RPP_LIMIT_PA_FACTOR.toString()} x ${pa.value} (${pa.source === "file" ? "file PA" : "Ariel PA"} ${i.year}) = ${money(limit)}`;
  const excessText = `MAX(0, ${money(pool)} - ${money(limit)}) = ${money(excess)}`;
  const priorText = `PriorCLC = ${money(prior)} (Ariel RPPHGH CLC ${i.year})`;
  return {
    year: i.year,
    pool: money(pool),
    paEffective: pa.value,
    paSource: pa.source,
    limit: money(limit),
    excess: money(excess),
    priorClc: money(prior),
    rpphghClc: money(rpp),
    rcahghClc: money(rca),
    emit,
    terms: {
      arielLowPrv: money(i.arielLowPrv),
      arielHighPrv: money(i.arielHighPrv),
      arielLowRetro: money(i.arielLowRetro),
      arielHighRetro: money(i.arielHighRetro),
      fileLow: money(i.fileLow),
      fileHigh: money(i.fileHigh),
    },
    explanationRpp: `RPPHGH_CLC = -MAX(0, Pool - Limit) - PriorCLC; Pool = ${poolText}; Limit = ${limitText}; Excess = ${excessText}; ${priorText}; RPPHGH_CLC = -${money(excess)} - (${money(prior)}) = ${money(rpp)}`,
    explanationRca: `RCAHGH_CLC = +MAX(0, Pool - Limit) - PriorCLC; Pool = ${poolText}; Limit = ${limitText}; Excess = ${excessText}; ${priorText}; RCAHGH_CLC = ${money(excess)} - (${money(prior)}) = ${money(rca)}`,
  };
}