import { toleranceNumber } from "../../config";
import { calculateAE } from "../../lib/ae";
import { yearOf } from "../../lib/dates";
import { money } from "../../lib/format";
import { txView } from "../../lib/service";
import { l2Rule, rateGap, skipRule } from "./_shared";

/** B47_AEAmount / 2990 (WARNING): AE magnitude sanity check when no earlier AE history exists. */
export const B47 = l2Rule({
  id: "B47",
  label: "B47_AEAmount",
  messageId: "2990",
  severity: "WARNING",
  visibility: "PUBLIC",
  overrideReasons: ["The reported annualized earnings are correct."],
  dataImportMessage: "Please verify that the Annualized Earnings amount of ${0} for {1} is correct.",
  portalMessage: "Please verify that the Annualized Earnings amount for the reporting year is correct.",
  evaluate(record, d, ctx) {
    const view = txView(d.employment, d);
    const min = toleranceNumber(ctx.config, "B47.min", 20000);
    const max = toleranceNumber(ctx.config, "B47.max", 120000);
    // Years before the first rate-table year cannot yield an AE (BUG-L2-RATES-2): start the back-walk there.
    const firstYear = Math.max(yearOf(d.employment.permanencyDate), ctx.rates.firstYear() ?? Number.NEGATIVE_INFINITY);
    for (let calcYear = firstYear; calcYear < d.eventYear - 1; calcYear++) {
      const prior = calculateAE(view, calcYear, ctx.rates, "withRetro");
      if (prior === null) return skipRule(ctx, "B47", record, rateGap(ctx, calcYear) ?? `RATE_MISSING:LOWRATE:${calcYear}`);
      if (prior.ae.gt(0)) return [];
    }
    const current = calculateAE(view, d.eventYear, ctx.rates, "withRetro");
    if (current === null) return skipRule(ctx, "B47", record, rateGap(ctx, d.eventYear) ?? `RATE_MISSING:LOWRATE:${d.eventYear}`);
    const ae = current.ae;
    if (ae.lte(0)) return [];
    if (ae.gt(max) || ae.lt(min)) return [{ yearScope: "CURRENT", params: { 0: money(ae), 1: d.eventYear }, calculated: { ae: ae.toFixed(2), min, max } }];
    return [];
  },
});