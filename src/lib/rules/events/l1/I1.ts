import { isBlank } from "@/lib/events/fields";
import { ALWAYS_MANDATORY_COLUMNS, type EventsCsvColumn } from "@/types";
import { defineRule } from "../../types";

/** I1_InputDataNotProvided / 8233. SIN is covered exclusively by I2 (architecture section 7.3). */
export const I1 = defineRule({
  id: "I1",
  label: "I1_InputDataNotProvided",
  messageId: "8233",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "{1} is a required field.",
  portalMessage: "A mandatory field was not provided in the data file.",
  evaluate(record) {
    if (!record) return [];
    const required: EventsCsvColumn[] = [...ALWAYS_MANDATORY_COLUMNS];
    if (record.eventType === "TERFIN" || record.eventType === "RETFIN") required.splice(3, 0, "EmploymentEndDate");
    return required.filter((f) => isBlank(record.rawValues[f])).map((f) => ({ field: f, params: { 1: f } }));
  },
});
