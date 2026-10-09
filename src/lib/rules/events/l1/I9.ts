import { isBlank } from "@/lib/events/fields";
import { EVENT_TYPES } from "@/types";
import { defineRule } from "../../types";

/** I9_InvalidEnum / 8034 - adopted by extension for EventType (architecture section 18 Q4). */
export const I9 = defineRule({
  id: "I9",
  label: "I9_InvalidEnum",
  messageId: "8034",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "{1} is in an invalid code.",
  portalMessage: "The provided value is in an invalid code.",
  evaluate(record) {
    if (!record) return [];
    const raw = record.rawValues.EventType;
    if (isBlank(raw)) return [];
    const t = raw.trim();
    if ((EVENT_TYPES as readonly string[]).includes(t)) return [];
    return [{ field: "EventType", params: { 1: t } }];
  },
});
