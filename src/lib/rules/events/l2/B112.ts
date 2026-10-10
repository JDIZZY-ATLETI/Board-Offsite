import { RET_NOTICE_RE } from "../../lib/context";
import { l2Rule } from "./_shared";

/** B112_RetirementNotice_Before_TERFIN / 1616 (TERFIN) · 8112 (DECFIN). */
export const B112 = l2Rule({
  id: "B112",
  label: "B112_RetirementNotice_Before_TERFIN",
  messageId: (d) => (d.params["1/2"] === "Death" ? "8112" : "1616"),
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: 'A retirement has been initiated for this member. To report final data for this member, please select "Retirement". To report a {1/2} for this member, please contact HOOPP.',
  portalMessage: 'A retirement has been initiated for this member. To report final data for this member, please select "Retirement". To report a {1/2} for this member, please contact HOOPP.',
  appliesTo: (record) => record.eventType === "TERFIN" || record.eventType === "DECFIN",
  evaluate(record, d) {
    const info = d.employment.otherInformation ?? "";
    if (!RET_NOTICE_RE.test(info)) return [];
    return [{ field: "EventType", params: { "1/2": record.eventType === "DECFIN" ? "Death" : "Termination" }, calculated: { otherInformation: info } }];
  },
});