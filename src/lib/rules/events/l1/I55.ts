import Decimal from "decimal.js";
import type { YearBlock, YearScope } from "@/types";
import { defineRule, type FindingDraft } from "../../types";

function check(block: YearBlock, scope: YearScope): FindingDraft | null {
  if (block.weeks === null || block.weeks === undefined) return null;
  if (block.lowContributions === null || block.lowContributions === undefined) return null;
  if (new Decimal(block.weeks).gt(0) && new Decimal(block.lowContributions).isZero()) {
    return {
      field: scope === "CURRENT" ? "LowContributions_CurrentYear" : "LowContributions_PreviousYear",
      yearScope: scope,
      params: {},
    };
  }
  return null;
}

/** I55_Zero_Weeks_And_Zero_LowContributions_Provided / 9349 (spec label spelled "Z\u00e9ro"). */
export const I55 = defineRule({
  id: "I55",
  label: "I55_Z\u00e9ro_Weeks_And_Z\u00e9ro_LowContributions_Provided",
  messageId: "9349",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "You have provided weeks for this member, please provide associated contributions.",
  portalMessage: "You have provided weeks for this member, please provide associated contributions.",
  evaluate(record) {
    if (!record) return [];
    return [check(record.currentYear, "CURRENT"), check(record.previousYear, "PREVIOUS")].filter((x): x is FindingDraft => x !== null);
  },
});
