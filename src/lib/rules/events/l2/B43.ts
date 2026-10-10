import { toleranceNumber } from "../../config";
import { money } from "../../lib/format";
import { aeDraft, aeYearOverYear } from "./_ae-rules";
import { l2Rule } from "./_shared";

/** B43_AEDecrease / 5613 (WARNING): AE down by more than $2,500. */
export const B43 = l2Rule({
  id: "B43",
  label: "B43_AEDecrease",
  messageId: "5613",
  severity: "WARNING",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  overrideReasons: [
    "Job reclassification",
    "Permanent reduction of full-time hours",
    "Change to lower-paying position",
    "The member held more than one position at different hourly rates",
    "Retro paid is Laboratory Medicine Funding Framework Agreement (LMFFA) compensation or pensionable bonus",
    "Other - Please provide explanation",
  ],
  dataImportMessage: "The Annualized Earnings amount of ${0} has decreased by ${1} from the prior year's Annualized Earnings of ${2}. To continue, update the entry or select an override reason.",
  portalMessage: "The Annualized Earnings amount has decreased from the prior year's Annualized Earnings. To continue, update the entry or select an override reason.",
  evaluate(_record, d, ctx) {
    const amount = toleranceNumber(ctx.config, "B43.amount", -2500);
    const hit = aeYearOverYear(d, ctx, (cur, prev) => cur.lt(prev.plus(amount)));
    if (!hit) return [];
    return [aeDraft(d, hit, { 0: money(hit.current), 1: money(hit.previous.minus(hit.current)), 2: money(hit.previous) })];
  },
});