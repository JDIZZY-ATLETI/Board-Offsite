import { gt0, SCOPES } from "../../lib/context";
import { addYears, endOrOpen, jan1 } from "../../lib/dates";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B22_MemberOnFreeAccrualEntireYearNoServiceRequired / 5604. Executed twice; PA only counts for the current year. */
export const B22 = l2Rule({
  id: "B22",
  label: "B22_MemberOnFreeAccrualEntireYearNoServiceRequired",
  messageId: "5604",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "This member is on a health leave and receiving free accrual during the reporting period. If the member has returned to work and resumed contributions in {2}, please report the Leave End Date.",
  portalMessage: "This member is on a health leave and receiving free accrual during the reporting period. If the member has returned to work and resumed contributions in reporting year, please report the Leave End Date.",
  evaluate(record, d) {
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const periodEnd = scope === "CURRENT" ? d.eventDate : addYears(d.eventDate, -1);
      const reported = gt0(b.weeks) || gt0(b.lowContributions) || gt0(b.highContributions) || (scope === "CURRENT" && gt0(b.pa));
      if (!reported) continue;
      const ltd = d.employment.serviceBreaks.find((br) => br.type === "LTD" && br.startDate <= jan1(year) && endOrOpen(br.endDate) >= periodEnd);
      if (ltd) out.push({ field: scope === "CURRENT" ? "Weeks_CurrentYear" : "Weeks_PreviousYear", yearScope: scope, params: { 2: year }, calculated: { ltdStart: ltd.startDate, ltdEnd: ltd.endDate ?? "open" } });
    }
    return out;
  },
});