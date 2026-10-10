import { l2Rule } from "./_shared";

/** B206_UnicityStatusDeleteEffectiveDate / 619: the derived D-NCT status would collide with an existing status date. */
export const B206 = l2Rule({
  id: "B206",
  label: "B206_UnicityStatusDeleteEffectiveDate",
  messageId: "619",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "StandardValidationModule",
  specNote: "Q17: the status effective date is MAX(EventDate, other employments' termination dates).",
  dataImportMessage: "There is an issue regarding the membership status effective date for this member. Please contact HOOPP for more information.",
  portalMessage: "There is an issue regarding the membership status effective date for this member. Please contact HOOPP for more information.",
  evaluate(_record, d) {
    const s = d.membershipStatus;
    if (!s) return [];
    const clash = d.member.membership.statusHistory.find((h) => h.effectiveDate === s.statusEffectiveDate);
    return clash ? [{ params: {}, calculated: { effectiveDate: s.statusEffectiveDate, existingStatus: clash.status ?? "", existingSubStatus: clash.subStatus ?? "" } }] : [];
  },
});