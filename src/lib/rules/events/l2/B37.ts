import Decimal from "decimal.js";
import { toleranceNumber } from "../../config";
import { lowContributionCalc } from "../../lib/ae";
import { dec, SCOPES } from "../../lib/context";
import { money } from "../../lib/format";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B37_Message / 3029: low contributions above the maximum for the weeks reported (Final Data variant: file values only). */
export const B37 = l2Rule({
  id: "B37",
  label: "B37_Message",
  messageId: "3029",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "Low Contributions for reporting year {1} cannot be greater than maximum amount of {2} for the weeks reported.",
  portalMessage: "Low Contributions cannot be greater than maximum amount of weeks reported.",
  evaluate(record, d, ctx) {
    const out: FindingDraft[] = [];
    const tol1 = toleranceNumber(ctx.config, "B37.tolerance1Weeks", 2);
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      const weeks = dec(b.weeks);
      const low = dec(b.lowContributions);
      if (!weeks || !low) continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const { calc, maxWeekly } = lowContributionCalc(weeks, year, ctx.rates);
      const tolerance = maxWeekly.times(tol1);
      const ceiling = calc.plus(tolerance).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (low.minus(calc).gt(tolerance)) {
        out.push({ field: scope === "CURRENT" ? "LowContributions_CurrentYear" : "LowContributions_PreviousYear", yearScope: scope, params: { 1: year, 2: money(ceiling) }, calculated: { calculatedLow: calc.toFixed(2), tolerance: tolerance.toFixed(2), reportedLow: low.toFixed(2), ympe: ctx.rates.ympe(year) } });
      }
    }
    return out;
  },
});