import { RET_NOTICE_RE } from "../../lib/context";
import { l2Rule } from "./_shared";

/** B113_NoRetirementNotice_Before_RETFIN / 9075. */
export const B113 = l2Rule({
  id: "B113",
  label: "B113_NoRetirementNotice_Before_RETFIN",
  messageId: "9075",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "A Notice of Retirement must be completed for this member before submitting final data.",
  portalMessage: "A Notice of Retirement must be completed for this member before submitting final data.",
  appliesTo: (record) => record.eventType === "RETFIN",
  evaluate(_record, d) {
    const info = d.employment.otherInformation ?? "";
    return RET_NOTICE_RE.test(info) ? [] : [{ field: "EventType", params: {}, calculated: { otherInformation: info } }];
  },
});