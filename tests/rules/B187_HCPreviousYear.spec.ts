import { describe, it } from "vitest";
import { B187_HCPreviousYear } from "@/lib/rules/events/l1/B187";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(B187_HCPreviousYear);

describe("B187_HCPreviousYear / 5049", () => {
  it("fires when HighContributions_PreviousYear is negative", () => {
    h.given(rec({ HighContributions_PreviousYear: "-1" })).expectFinding({ messageId: "5049", field: "HighContributions_PreviousYear", yearScope: "PREVIOUS", params: { 0: "-1" }, dataImportMessage: "Negative value cannot be reported for -1.", portalMessage: "Negative value cannot be reported for High Contributions previous year." });
  });
  it("does not fire for zero, positive, blank or non-numeric values", () => {
    h.given(rec({ HighContributions_PreviousYear: "0.00" })).expectNoFinding();
    h.given(rec({ HighContributions_PreviousYear: "12.50" })).expectNoFinding();
    h.given(rec({ HighContributions_PreviousYear: "" })).expectNoFinding();
    h.given(rec({ HighContributions_PreviousYear: "abc" })).expectNoFinding();
    h.given(rec({ HighContributions_PreviousYear: "-0" })).expectNoFinding();
  });
});
