import { isBlank, parseIntegerField } from "@/lib/events/fields";
import { INTEGER_COLUMNS } from "@/types";
import { defineRule, type FindingDraft } from "../../types";

/** I8_InvalidInteger / 5131. For SIN the value is never echoed (architecture section 13.3). */
export const I8 = defineRule({
  id: "I8",
  label: "I8_InvalidInteger",
  messageId: "5131",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "{1} is in an invalid number format. Please provide an integer value.",
  portalMessage: "The integer value is in an invalid number format. Please provide an integer value.",
  evaluate(record) {
    if (!record) return [];
    const out: FindingDraft[] = [];
    const sinRaw = record.rawValues.SIN;
    if (!isBlank(sinRaw) && !/^\d{1,9}$/.test(sinRaw.trim())) {
      out.push({ field: "SIN", params: { 1: "SIN" }, calculated: { masked: true } });
    }
    for (const col of INTEGER_COLUMNS) {
      const raw = record.rawValues[col];
      if (isBlank(raw)) continue;
      if (!parseIntegerField(raw).ok) out.push({ field: col, params: { 1: raw.trim() } });
    }
    return out;
  },
});
