import { toleranceNumber } from "../../config";
import { aeDraft, aeYearOverYear } from "./_ae-rules";
import { l2Rule } from "./_shared";

/** B41AEIncreaseHOOPP / 6065 (INFORMATION, PRIVATE): AE up more than 50 %. */
export const B41 = l2Rule({
  id: "B41",
  label: "B41AEIncreaseHOOPP",
  messageId: "6065",
  severity: "INFORMATION",
  visibility: "PRIVATE",
  tool: "CustomDLL",
  dataImportMessage: "Verify Earnings increase greater than 50%.",
  portalMessage: "Verify Earnings increase greater than 50%.",
  evaluate(record, d, ctx) {
    const pct = toleranceNumber(ctx.config, "B41.pct", 0.5);
    const hit = aeYearOverYear("B41", record, d, ctx, (cur, prev) => cur.gt(prev.times(1 + pct)));
    return hit ? [aeDraft(d, hit, {})] : [];
  },
});