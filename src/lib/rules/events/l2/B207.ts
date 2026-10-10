import { SCOPES } from "../../lib/context";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B207_DuplicatePensionAdjustment / 2153: same employer, calculation year and entry date (= execution date). */
export const B207 = l2Rule({
  id: "B207",
  label: "B207_DuplicatePensionAdjustment",
  messageId: "2153",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "A pension adjustment update has already been made for this member today. Please contact HOOPP for more information.",
  portalMessage: "A pension adjustment update has already been made for this member today. Please contact HOOPP for more information.",
  evaluate(record, d, ctx) {
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      if (typeof b.pa !== "number") continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const dup = d.member.pensionAdjustments.find((p) => p.employerId === ctx.batch.employerId && p.calculationYear === year && p.entryDate === ctx.batch.executionDate);
      if (dup) out.push({ field: scope === "CURRENT" ? "PA_CurrentYear" : "PA_PreviousYear", yearScope: scope, params: {}, calculated: { existingPaId: dup.paId, existingAmount: dup.amount, entryDate: dup.entryDate } });
    }
    return out;
  },
});