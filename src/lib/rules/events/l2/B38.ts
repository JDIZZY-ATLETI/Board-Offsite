import Decimal from "decimal.js";
import { toleranceNumber } from "../../config";
import { lowContributionCalc } from "../../lib/ae";
import { dec, gt0, SCOPES } from "../../lib/context";
import { money } from "../../lib/format";
import type { FindingDraft } from "../../types";
import { l2Rule, rateGap, skipRule } from "./_shared";

/** B38_Message / 480 (WARNING): high contributions present but low below the calculated low less one week. */
export const B38 = l2Rule({
  id: "B38",
  label: "B38_Message",
  messageId: "480",
  severity: "WARNING",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  overrideReasons: ["Member’s annualized earnings moved from less than to more than the YMPE.", "Member held more than one position with one rate of pay below the YMPE and one rate above the YMPE."],
  dataImportMessage: "Low Contributions for reporting year {1} cannot be less than {2} based on the weeks reported. To continue, update the entry or select an override reason.",
  portalMessage: "Low Contributions cannot be less than weeks reported. To continue, update the entry or select an override reason.",
  evaluate(record, d, ctx) {
    const out: FindingDraft[] = [];
    const tolWeeks = toleranceNumber(ctx.config, "B38.toleranceWeeks", -1);
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      const weeks = dec(b.weeks);
      const low = dec(b.lowContributions);
      if (!weeks || !low || !gt0(b.highContributions)) continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const pieces = lowContributionCalc(weeks, year, ctx.rates);
      if (!pieces) {
        skipRule(ctx, "B38", record, rateGap(ctx, year) ?? `RATE_MISSING:MGA:${year}`);
        continue;
      }
      const { calc, maxWeekly } = pieces;
      const floor = calc.plus(maxWeekly.times(tolWeeks)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (low.lt(floor)) {
        out.push({ field: scope === "CURRENT" ? "LowContributions_CurrentYear" : "LowContributions_PreviousYear", yearScope: scope, params: { 1: year, 2: money(floor) }, calculated: { calculatedLow: calc.toFixed(2), reportedLow: low.toFixed(2), high: String(b.highContributions) } });
      }
    }
    return out;
  },
});