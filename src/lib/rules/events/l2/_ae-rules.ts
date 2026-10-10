import Decimal from "decimal.js";
import type { FileDerived } from "@/lib/derivation/provisional";
import { calculateAE } from "../../lib/ae";
import { txView } from "../../lib/service";
import type { FindingDraft, RuleContext } from "../../types";

export interface AeComparison {
  validationYear: number;
  current: Decimal;
  previous: Decimal;
}

/**
 * Spec loop shared by B40/B41/B43/B44 (Events): for ValidationYear = EventYear down to EventYear-1, compare
 * AE(V) with AE(V-1) when the latter is non-zero. The last triggering iteration wins (spec assigns ErrorYear_*
 * inside the loop); one finding is produced. Years without any AE data (0) are skipped (section 18 Q27).
 */
export function aeYearOverYear(d: FileDerived, ctx: RuleContext, trigger: (cur: Decimal, prev: Decimal) => boolean): AeComparison | null {
  const view = txView(d.employment, d);
  let hit: AeComparison | null = null;
  for (const v of [d.eventYear, d.eventYear - 1]) {
    const prev = calculateAE(view, v - 1, ctx.rates).ae;
    if (prev.isZero()) continue;
    const cur = calculateAE(view, v, ctx.rates).ae;
    // Q27: CalculateAE returns 0 when the year has no service at all ("no data"), which is not a change in earnings.
    if (cur.isZero()) continue;
    if (trigger(cur, prev)) hit = { validationYear: v, current: cur, previous: prev };
  }
  return hit;
}

export function aeDraft(d: FileDerived, hit: AeComparison, params: FindingDraft["params"]): FindingDraft {
  return {
    yearScope: hit.validationYear === d.eventYear ? "CURRENT" : "PREVIOUS",
    params,
    calculated: { validationYear: hit.validationYear, currentAE: hit.current.toFixed(2), previousAE: hit.previous.toFixed(2), errorYear: d.eventYear },
  };
}