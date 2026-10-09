import { isBlank } from "@/lib/events/fields";
import { EVENTS_CSV_COLUMNS, MAX_LENGTHS } from "@/types";
import { defineRule, type FindingDraft } from "../../types";

/** I3_MaximumMandatoryFieldsLength / 9519: numeric fields only for Events (names checked in Enrolments/MBI only). */
export const I3 = defineRule({
  id: "I3",
  label: "I3_MaximumMandatoryFieldsLength",
  messageId: "9519",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage:
    "The field {File.FieldName} exceeds the maximum acceptable length of {Max Length} characters (including decimal point, if applicable).",
  portalMessage:
    "The field {File.FieldName} exceeds the maximum acceptable length of {Max Length} characters (including decimal point, if applicable).",
  evaluate(record) {
    if (!record) return [];
    const out: FindingDraft[] = [];
    for (const col of EVENTS_CSV_COLUMNS) {
      const max = MAX_LENGTHS[col];
      if (max === undefined) continue;
      const raw = record.rawValues[col];
      if (isBlank(raw)) continue;
      const len = raw.trim().length;
      if (len > max) {
        out.push({
          field: col,
          yearScope: col.endsWith("PreviousYear") ? "PREVIOUS" : "CURRENT",
          params: { "File.FieldName": col, "Max Length": max },
          calculated: { length: len },
        });
      }
    }
    return out;
  },
});
