import { isBlank } from "@/lib/events/fields";
import { defineRule } from "../../types";

/** I2_InputIdentifierNotProvided / 2031 */
export const I2 = defineRule({
  id: "I2",
  label: "I2_InputIdentifierNotProvided",
  messageId: "2031",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "SIN is a mandatory field in the data file.",
  portalMessage: "SIN is a mandatory field in the data file.",
  evaluate(record) {
    if (!record || !isBlank(record.rawValues.SIN)) return [];
    return [{ field: "SIN", params: {} }];
  },
});
