import { toleranceNumber } from "../../config";
import { calculateAE } from "../../lib/ae";
import { yearOf } from "../../lib/dates";
import { money } from "../../lib/format";
import { txView } from "../../lib/service";
import { l2Rule } from "./_shared";

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
  evaluate(_record, d, ctx) {
    const view = txView(d.employment, d);
    const min = toleranceNumber(ctx.config, "B47.min", 20000);
    const max = toleranceNumber(ctx.config, "B47.max", 120000);
    for (let calcYear = yearOf(d.employment.permanencyDate); calcYear < d.eventYear - 1; calcYear++) {
      if (calculateAE(view, calcYear, ctx.rates, "withRetro").ae.gt(0)) return [];
    }
    const ae = calculateAE(view, d.eventYear, ctx.rates, "withRetro").ae;
    if (ae.lte(0)) return [];
    if (ae.gt(max) || ae.lt(min)) return [{ yearScope: "CURRENT", params: { 0: money(ae), 1: d.eventYear }, calculated: { ae: ae.toFixed(2), min, max } }];
    return [];
  },
});