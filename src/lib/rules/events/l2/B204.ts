import { l2Rule } from "./_shared";

/** B204_PersonMatchingEntityInstance / 6279: two or more Ariel members share the SIN. */
export const B204 = l2Rule({
  id: "B204",
  label: "B204_PersonMatchingEntityInstance",
  messageId: "6279",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "StandardValidationModule",
  dataImportMessage: "Duplicate SIN. Please contact HOOPP for more information.",
  portalMessage: "Duplicate SIN. Please contact HOOPP for more information.",
  evaluate(record, _d, ctx) {
    const n = ctx.ariel.membersBySin(record.sinPseudo!).length;
    return n >= 2 ? [{ field: "SIN", params: {}, calculated: { members: n } }] : [];
  },
});