import { defineRule } from "../../types";

/** I10_MultiplePersonEntries / 910: every row sharing a SIN is rejected. SIN is masked in the message. */
export const I10 = defineRule({
  id: "I10",
  label: "I10_MultiplePersonEntries",
  messageId: "910",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "{1} appears multiple times in file. Please review data for each instance and only submit one instance of correct data.",
  portalMessage: "This SIN appears multiple times in file. Please review data for each instance and only submit one instance of correct data.",
  appliesTo: (record) => !!record && record.sin !== null,
  evaluate(record, ctx) {
    if (!record || !record.sin || !record.sinMasked) return [];
    const n = ctx.sinCounts.get(record.sin) ?? 0;
    if (n <= 1) return [];
    return [{ field: "SIN", params: { 1: record.sinMasked }, calculated: { occurrences: n, masked: true } }];
  },
});
