import { defineRule } from "../../types";

/**
 * I42_FutureDate / 8106. Spec level 2 but needs no Ariel data, so it runs in Phase 1.
 * Applies to TERFIN (EmploymentEndDate), DECFIN (DateOfDeath) and, per architecture section 18 Q5, RETFIN.
 */
export const I42 = defineRule({
  id: "I42",
  label: "I42_FutureDate",
  messageId: "8106",
  level: "L2",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  requiresAriel: false,
  dataImportMessage: "Event date must be earlier than or equal to today's date.",
  portalMessage: "Event date must be earlier than or equal to today's date.",
  appliesTo(record, ctx) {
    if (!record || !record.eventType) return false;
    if (record.eventType === "RETFIN") return ctx.config.i42ApplyToRetfin;
    return true;
  },
  evaluate(record, ctx) {
    if (!record || !record.eventType) return [];
    const field = record.eventType === "DECFIN" ? "DateOfDeath" : "EmploymentEndDate";
    const d = record.eventType === "DECFIN" ? record.dateOfDeath : record.employmentEndDate;
    if (!d) return [];
    const exec = ctx.batch.executionDate;
    if (d > exec) {
      // CSV DECFIN rows have no DateOfDeath column; the finding points at the column that carried the date.
      const reportedField = field === "DateOfDeath" && record.rawValues.DateOfDeath == null ? "EmploymentEndDate" : field;
      return [{ field: reportedField, params: {}, calculated: { eventDate: d, executionDate: exec } }];
    }
    return [];
  },
});
