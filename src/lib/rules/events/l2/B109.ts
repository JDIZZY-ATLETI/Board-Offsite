import { l2Rule } from "./_shared";

/** B109_EventDate_Before_PermanencyDate / 7476. */
export const B109 = l2Rule({
  id: "B109",
  label: "B109_EventDate_Before_PermanencyDate",
  messageId: "7476",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "Event date must be after the member’s Enrolment Date.",
  portalMessage: "Event date must be after the member’s Enrolment Date.",
  evaluate(record, d) {
    if (d.eventDate < d.employment.permanencyDate) {
      return [{ field: record.eventType === "DECFIN" && record.rawValues.DateOfDeath != null ? "DateOfDeath" : "EmploymentEndDate", params: {}, calculated: { eventDate: d.eventDate, permanencyDate: d.employment.permanencyDate } }];
    }
    return [];
  },
});