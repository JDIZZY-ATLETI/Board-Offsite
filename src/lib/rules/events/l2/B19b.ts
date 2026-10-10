import { SCOPES, scopePresent, zeroOrBlank } from "../../lib/context";
import { dec31, jan1, maxDate, yearOf } from "../../lib/dates";
import { breakCovering } from "../../lib/breaks";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B19b_Annualized_Earnings_Have_Not_Be_Reported / 2955: inverse of B19. */
export const B19b = l2Rule({
  id: "B19b",
  label: "B19b_Annualized_Earnings_Have_Not_Be_Reported",
  messageId: "2955",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "Annualized earnings for {1} must be provided for this member.",
  portalMessage: "Annualized earnings must be reported for this member.",
  evaluate(record, d) {
    const out: FindingDraft[] = [];
    const emp = d.employment;
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      if (!zeroOrBlank(b.annualizedEarnings)) continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      if (scope === "PREVIOUS") {
        // Section 7.3: an all-blank previous-year block is not evaluated.
        if (!scopePresent(record, "PREVIOUS")) continue;
        const reported = emp.salaryRates.some((s) => s.type === "REPORT" && yearOf(s.effectiveDate) === year);
        if (reported || yearOf(emp.permanencyDate) > year) continue;
      }
      const startBound = maxDate(jan1(year), emp.permanencyDate);
      const endBound = scope === "CURRENT" ? d.eventDate : dec31(year);
      const wso = breakCovering(emp, "WSO", startBound, endBound);
      if (wso) out.push({ field: scope === "CURRENT" ? "AnnualizedEarnings_CurrentYear" : "AnnualizedEarnings_PreviousYear", yearScope: scope, params: { 1: year }, calculated: { wsoStart: wso.startDate, wsoEnd: wso.endDate ?? "open" } });
    }
    return out;
  },
});