import { isBlank, parseDecimalField } from "@/lib/events/fields";
import { DECIMAL_COLUMNS } from "@/types";
import { defineRule, type FindingDraft } from "../../types";

/** I7_InvalidDecimal / 6503 (current-year fields) and 6642 (previous-year fields) - architecture section 18 Q3. */
export const I7 = defineRule({
  id: "I7",
  label: "I7_InvalidDecimal",
  messageId: (d) => (d.yearScope === "PREVIOUS" ? "6642" : "6503"),
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "{1} is invalid. Value cannot have more than two decimal places.",
  portalMessage: "The decimal value is invalid. Value cannot have more than two decimal places.",
  evaluate(record) {
    if (!record) return [];
    const out: FindingDraft[] = [];
    for (const col of DECIMAL_COLUMNS) {
      const raw = record.rawValues[col];
      if (isBlank(raw)) continue;
      if (!parseDecimalField(raw).ok) {
        out.push({ field: col, yearScope: col.endsWith("PreviousYear") ? "PREVIOUS" : "CURRENT", params: { 1: raw.trim() } });
      }
    }
    return out;
  },
});
