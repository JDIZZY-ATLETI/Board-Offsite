import Decimal from "decimal.js";
import type { YearBlock, YearScope } from "@/types";
import { defineRule, type FindingDraft } from "../../types";

function positive(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  return new Decimal(v).gt(0);
}

function check(block: YearBlock, scope: YearScope): FindingDraft | null {
  if (positive(block.weeks) && positive(block.annualizedEarnings)) {
    return {
      field: scope === "CURRENT" ? "Weeks_CurrentYear" : "Weeks_PreviousYear",
      yearScope: scope,
      params: {},
    };
  }
  return null;
}

/** I32_Weeks_And_AnnualizedEarnings_Provided / 4999 */
export const I32 = defineRule({
  id: "I32",
  label: "I32_Weeks_And_AnnualizedEarnings_Provided",
  messageId: "4999",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "Weeks and Annualized Earnings cannot both be greater than 0.",
  portalMessage: "Weeks and Annualized Earnings cannot both be greater than 0",
  evaluate(record) {
    if (!record) return [];
    return [check(record.currentYear, "CURRENT"), check(record.previousYear, "PREVIOUS")].filter((x): x is FindingDraft => x !== null);
  },
});
