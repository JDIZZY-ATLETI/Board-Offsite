import { l2Rule } from "./_shared";

/** B203_StatusDateAndStatusCode / 619: status without date or date without status (Ariel or the derived D-NCT item). */
export const B203 = l2Rule({
  id: "B203",
  label: "B203_StatusDateAndStatusCode",
  messageId: "619",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "StandardValidationModule",
  dataImportMessage: "There is an issue regarding the membership status for this member. Please contact HOOPP for more information.",
  portalMessage: "There is an issue regarding the membership status for this member. Please contact HOOPP for more information.",
  evaluate(_record, d) {
    const m = d.member.membership;
    const arielBad = (m.status !== null && m.status !== "" && m.statusEffectiveDate === null) || ((m.status === null || m.status === "") && m.statusEffectiveDate !== null);
    const s = d.membershipStatus;
    const derivedBad = s ? (s.status && !s.statusEffectiveDate) || (!s.status && s.statusEffectiveDate) : false;
    if (arielBad || derivedBad) return [{ params: {}, calculated: { source: arielBad ? "ariel" : "derived", status: m.status ?? "", statusEffectiveDate: m.statusEffectiveDate ?? "" } }];
    return [];
  },
});