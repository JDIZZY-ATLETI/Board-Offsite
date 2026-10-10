import { toleranceNumber } from "../../config";
import { money, pct2 } from "../../lib/format";
import { aeDraft, aeYearOverYear } from "./_ae-rules";
import { l2Rule } from "./_shared";

/** B40_AEIncrease / 1238 (WARNING): AE up more than 15 % year over year. */
export const B40 = l2Rule({
  id: "B40",
  label: "B40_AEIncrease",
  messageId: "1238",
  severity: "WARNING",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  overrideReasons: [
    "The member received a promotion",
    "The member was compensated for additional responsibilities",
    "Job reclassification",
    "Contract settlement",
    "Step/range increase",
    "Contract settlement and step increase",
    "Other - please provide explanation",
  ],
  dataImportMessage: "The Annualized Earnings amount of ${0} is {1}% greater than the prior year's Annualized Earnings of ${2}. To continue, update the entry or select an override reason.",
  portalMessage: "The Annualized Earnings amount for the reporting year is greater than the prior year's Annualized Earnings. To continue, update the entry or select an override reason.",
  evaluate(record, d, ctx) {
    const pct = toleranceNumber(ctx.config, "B40.pct", 0.15);
    const hit = aeYearOverYear("B40", record, d, ctx, (cur, prev) => cur.gt(prev.times(1 + pct)));
    if (!hit) return [];
    const increase = hit.current.minus(hit.previous).div(hit.previous).times(100);
    return [aeDraft(d, hit, { 0: money(hit.current), 1: pct2(increase), 2: money(hit.previous) })];
  },
});