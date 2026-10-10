import { l2Rule } from "./_shared";

/** B202_PersonValidateUnicityOfAddress / 6908: Events never creates addresses, so only pre-existing duplicates can fire. */
export const B202 = l2Rule({
  id: "B202",
  label: "B202_PersonValidateUnicityOfAddress",
  messageId: "6908",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "StandardValidationModule",
  dataImportMessage: "An address update has already been made for this member today. Please contact HOOPP for more information.",
  portalMessage: "An address update has already been made for this member today. Please contact HOOPP for more information.",
  evaluate(_record, d) {
    const seen = new Map<string, number>();
    for (const a of d.member.addresses) seen.set(a.effectiveStartDate, (seen.get(a.effectiveStartDate) ?? 0) + 1);
    const dup = [...seen.entries()].find(([, n]) => n >= 2);
    return dup ? [{ params: {}, calculated: { effectiveStartDate: dup[0], count: dup[1] } }] : [];
  },
});