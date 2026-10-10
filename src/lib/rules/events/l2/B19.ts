import { gt0, SCOPES } from "../../lib/context";
import { dec31, jan1, maxDate } from "../../lib/dates";
import { breakCovering } from "../../lib/breaks";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B19_Annualized_Earnings_Should_Not_Be_Reported / 9815: AE only with a waived-contribution (WSO) break. */
export const B19 = l2Rule({
  id: "B19",
  label: "B19_Annualized_Earnings_Should_Not_Be_Reported",
  messageId: "9815",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "Annualized earnings should not be reported for this member.",
  portalMessage: "Annualized earnings should not be reported for this member.",
  evaluate(record, d) {
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      if (!gt0(b.annualizedEarnings)) continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const startBound = maxDate(jan1(year), d.employment.permanencyDate);
      const endBound = scope === "CURRENT" ? d.eventDate : dec31(year);
      if (!breakCovering(d.employment, "WSO", startBound, endBound)) {
        out.push({ field: scope === "CURRENT" ? "AnnualizedEarnings_CurrentYear" : "AnnualizedEarnings_PreviousYear", yearScope: scope, params: {}, calculated: { year } });
      }
    }
    return out;
  },
});