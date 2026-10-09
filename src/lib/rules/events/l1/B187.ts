import { numericValue } from "@/lib/events/fields";
import type { EventsCsvColumn, YearScope } from "@/types";
import { defineRule, type Rule } from "../../types";

interface NegativeSpec {
  id: string;
  label: string;
  messageId: string;
  field: EventsCsvColumn;
  yearScope: YearScope;
  portalLabel: string;
}

const SPECS: NegativeSpec[] = [
  { id: "B187_WeeksCurrentYear", label: "B187_NegativeValues_WeeksCurrentYear", messageId: "9099", field: "Weeks_CurrentYear", yearScope: "CURRENT", portalLabel: "Weeks Current Year" },
  { id: "B187_LowContributionsCurrentYear", label: "B187_NegativeValues_LowContributionsCurrentYear", messageId: "4423", field: "LowContributions_CurrentYear", yearScope: "CURRENT", portalLabel: "Low Contributions current year" },
  { id: "B187_HighContributionsCurrentYear", label: "B187_NegativeValues_HighContributionsCurrentYear", messageId: "4869", field: "HighContributions_CurrentYear", yearScope: "CURRENT", portalLabel: "High Contributions current year" },
  { id: "B187_WeeksPreviousYear", label: "B187_NegativeValues_WeeksPreviousYear", messageId: "7902", field: "Weeks_PreviousYear", yearScope: "PREVIOUS", portalLabel: "Weeks previous year" },
  { id: "B187_LCPreviousYear", label: "B187_NegativeValues_LCPreviousYear", messageId: "494", field: "LowContributions_PreviousYear", yearScope: "PREVIOUS", portalLabel: "Low Contributions previous year" },
  // Spec reuses the LC label for the High previous-year check; internal id disambiguates.
  { id: "B187_HCPreviousYear", label: "B187_NegativeValues_LCPreviousYear", messageId: "5049", field: "HighContributions_PreviousYear", yearScope: "PREVIOUS", portalLabel: "High Contributions previous year" },
];

function negativeRule(s: NegativeSpec): Rule {
  return defineRule({
    id: s.id,
    label: s.label,
    messageId: s.messageId,
    level: "L1",
    severity: "COMPLETE_MEMBER_ERROR",
    visibility: "PUBLIC",
    dataImportMessage: "Negative value cannot be reported for {0}.",
    portalMessage: `Negative value cannot be reported for ${s.portalLabel}.`,
    evaluate(record) {
      if (!record) return [];
      const raw = record.rawValues[s.field];
      const n = numericValue(raw);
      if (n === null || !n.isNegative() || n.isZero()) return [];
      return [{ field: s.field, yearScope: s.yearScope, params: { 0: (raw as string).trim() } }];
    },
  });
}

export const B187_RULES: Rule[] = SPECS.map(negativeRule);
export const [
  B187_WeeksCurrentYear,
  B187_LowContributionsCurrentYear,
  B187_HighContributionsCurrentYear,
  B187_WeeksPreviousYear,
  B187_LCPreviousYear,
  B187_HCPreviousYear,
] = B187_RULES;
