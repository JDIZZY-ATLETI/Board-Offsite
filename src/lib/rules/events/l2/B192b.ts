import { isMdcCoreData } from "../../lib/context";
import { yearOf } from "../../lib/dates";
import { l2Rule } from "./_shared";

/** B192b_ReportingNoDataForPreviousYearEventsAndMDC-1WasNeverReceived / 7166. Blank differs from 0. */
export const B192b = l2Rule({
  id: "B192b",
  label: "B192b_ReportingNoDataForPreviousYearEventsAndMDC-1WasNeverReceived",
  messageId: "7166",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "Previous Year data for {0} is required. If no contributions were made for {0}, please report zero weeks and contributions.",
  portalMessage: "Previous Year data is required. ",
  evaluate(record, d) {
    if (yearOf(d.employment.permanencyDate) >= d.eventYear) return [];
    const py = record.previousYear;
    const blank = py.weeks === null || py.lowContributions === null || py.pa === null;
    if (!blank) return [];
    const year = d.eventYear - 1;
    const mdc = d.employment.service.find((s) => s.type === "CTSRV" && isMdcCoreData(s.summaryAttribute) && yearOf(s.targetDate) === year);
    if (mdc) return [];
    const field = py.weeks === null ? "Weeks_PreviousYear" : py.lowContributions === null ? "LowContributions_PreviousYear" : "PA_PreviousYear";
    return [{ field, yearScope: "PREVIOUS", params: { 0: year }, calculated: { permanencyYear: yearOf(d.employment.permanencyDate) } }];
  },
});