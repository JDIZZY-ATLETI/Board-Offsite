import { isBlank, parseDateField } from "@/lib/events/fields";
import { DATE_COLUMNS } from "@/types";
import { defineRule } from "../../types";

/** I5_InvalidDate / 825 */
export const I5 = defineRule({
  id: "I5",
  label: "I5_InvalidDate",
  messageId: "825",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "{1} is invalid. Date must be in MMDDYYYY format.",
  portalMessage: "The date value is invalid. Date must be in MMDDYYYY format.",
  evaluate(record) {
    if (!record) return [];
    const out = [];
    for (const col of DATE_COLUMNS) {
      const raw = record.rawValues[col];
      if (isBlank(raw)) continue;
      if (!parseDateField(raw).ok) out.push({ field: col, params: { 1: raw.trim() } });
    }
    return out;
  },
});
