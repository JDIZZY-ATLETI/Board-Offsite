import { l2Rule } from "./_shared";

/** B205_SubStatusDateAndSubStatusCode / 1070: sub-status / sub-status date inconsistency. */
export const B205 = l2Rule({
  id: "B205",
  label: "B205_SubStatusDateAndSubStatusCode",
  messageId: "1070",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "StandardValidationModule",
  dataImportMessage: "There is an issue regarding the membership sub-status for this member. Please contact HOOPP for more information.",
  portalMessage: "There is an issue regarding the membership sub-status for this member. Please contact HOOPP for more information.",
  evaluate(_record, d) {
    const m = d.member.membership;
    const bad = (m.subStatus !== null && m.subStatus !== "" && m.subStatusEffectiveDate === null) || ((m.subStatus === null || m.subStatus === "") && m.subStatusEffectiveDate !== null);
    return bad ? [{ params: {}, calculated: { subStatus: m.subStatus ?? "", subStatusEffectiveDate: m.subStatusEffectiveDate ?? "" } }] : [];
  },
});