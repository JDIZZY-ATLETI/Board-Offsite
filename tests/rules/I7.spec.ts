import { describe, it } from "vitest";
import { I7 } from "@/lib/rules/events/l1/I7";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I7);

describe("I7_InvalidDecimal / 6503 (current year) and 6642 (previous year)", () => {
  it("uses 6503 for current-year decimal fields", () => {
    h.given(rec({ Weeks_CurrentYear: "38.123" })).expectFinding({ messageId: "6503", field: "Weeks_CurrentYear", yearScope: "CURRENT", params: { 1: "38.123" }, dataImportMessage: "38.123 is invalid. Value cannot have more than two decimal places.", portalMessage: "The decimal value is invalid. Value cannot have more than two decimal places." });
    h.given(rec({ LowContributions_CurrentYear: "abc" })).expectFinding({ messageId: "6503", field: "LowContributions_CurrentYear" });
    h.given(rec({ HighContributions_CurrentYear: "1,234.00" })).expectFinding({ messageId: "6503", field: "HighContributions_CurrentYear" });
  });
  it("uses 6642 for previous-year decimal fields", () => {
    h.given(rec({ LowContributions_PreviousYear: "12.345" })).expectFinding({ messageId: "6642", field: "LowContributions_PreviousYear", yearScope: "PREVIOUS" });
    h.given(rec({ Weeks_PreviousYear: "x" })).expectFinding({ messageId: "6642" });
  });
  it("accepts integers, up to two decimals and negatives (B187 handles sign)", () => {
    h.given(rec({ Weeks_CurrentYear: "38", LowContributions_CurrentYear: "1950.2", HighContributions_PreviousYear: "-1.50" })).expectNoFinding();
  });
});
