import { employmentFor } from "@/lib/derivation/provisional";
import { defineRule } from "../../types";

/** B2_RejectMemberCreation / 1418: SIN must belong to a member with an employment at the reporting employer. */
export const B2 = defineRule({
  id: "B2",
  label: "B2_RejectMemberCreation",
  messageId: "1418",
  level: "L2",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  requiresAriel: true,
  dataImportMessage: "This SIN does not match any members at your organization. If this is a new enrolment, please complete the Enrolment for this member.",
  portalMessage: "This SIN does not match any members at your organization. If this is a new enrolment, please complete the Enrolment for this member.",
  appliesTo: (record) => Boolean(record?.sinPseudo),
  evaluate(record, ctx) {
    if (!record?.sinPseudo) return [];
    const members = ctx.ariel.membersBySin(record.sinPseudo);
    if (members.length === 0) return [{ field: "SIN", params: {}, calculated: { reason: "MEMBER_NOT_FOUND" } }];
    if (!members.some((m) => employmentFor(m, ctx.batch.employerId))) return [{ field: "SIN", params: {}, calculated: { reason: "NO_EMPLOYMENT_AT_EMPLOYER", employerId: ctx.batch.employerId } }];
    return [];
  },
});