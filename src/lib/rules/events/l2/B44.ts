import { toleranceNumber } from "../../config";
import { aeDraft, aeYearOverYear } from "./_ae-rules";
import { l2Rule } from "./_shared";

/** B44_AEDecreaseHOOPP / 1646 (INFORMATION, PRIVATE): AE down by more than $50,000. */
export const B44 = l2Rule({
  id: "B44",
  label: "B44_AEDecreaseHOOPP",
  messageId: "1646",
  severity: "INFORMATION",
  visibility: "PRIVATE",
  tool: "CustomDLL",
  dataImportMessage: "Verify Earnings decrease greater than $50000",
  portalMessage: "Verify Earnings decrease greater than $50000",
  evaluate(_record, d, ctx) {
    const amount = toleranceNumber(ctx.config, "B44.amount", -50000);
    const hit = aeYearOverYear(d, ctx, (cur, prev) => cur.lt(prev.plus(amount)));
    return hit ? [aeDraft(d, hit, {})] : [];
  },
});