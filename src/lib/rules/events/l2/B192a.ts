import { gt0, isMdcCoreData, SCOPES } from "../../lib/context";
import { yearOf } from "../../lib/dates";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B192a_DuplicateMDCdataReceivedinEventsFile / 405: MDC data for the year is already in Ariel. Executed per year scope. */
export const B192a = l2Rule({
  id: "B192a",
  label: "B192a_DuplicateMDCdataReceivedinEventsFile",
  messageId: "405",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "Data for {0} has already been reported. Please remove this data to continue.  If you need to adjust what was previously reported please contact HOOPP.",
  portalMessage: "Data has already been reported. Please remove this data to continue. If you need to adjust what was previously reported please contact HOOPP.",
  evaluate(record, d) {
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      const any = gt0(b.weeks) || gt0(b.lowContributions) || gt0(b.highContributions) || gt0(b.pa) || gt0(b.annualizedEarnings);
      if (!any) continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const mdc = d.employment.service.find((s) => s.type === "CTSRV" && isMdcCoreData(s.summaryAttribute) && yearOf(s.targetDate) === year);
      if (mdc) out.push({ field: scope === "CURRENT" ? "Weeks_CurrentYear" : "Weeks_PreviousYear", yearScope: scope, params: { 0: year }, calculated: { mdcServiceTx: mdc.txId, mdcWeeks: mdc.amount } });
    }
    return out;
  },
});