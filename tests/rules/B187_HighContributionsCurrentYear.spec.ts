import { describe, it } from "vitest";
import { B187_HighContributionsCurrentYear } from "@/lib/rules/events/l1/B187";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(B187_HighContributionsCurrentYear);

describe("B187_HighContributionsCurrentYear / 4869", () => {
  it("fires when HighContributions_CurrentYear is negative", () => {
    h.given(rec({ HighContributions_CurrentYear: "-0.01" })).expectFinding({ messageId: "4869", field: "HighContributions_CurrentYear", yearScope: "CURRENT", params: { 0: "-0.01" }, dataImportMessage: "Negative value cannot be reported for -0.01.", portalMessage: "Negative value cannot be reported for High Contributions current year." });
  });
  it("does not fire for zero, positive, blank or non-numeric values", () => {
    h.given(rec({ HighContributions_CurrentYear: "0.00" })).expectNoFinding();
    h.given(rec({ HighContributions_CurrentYear: "12.50" })).expectNoFinding();
    h.given(rec({ HighContributions_CurrentYear: "" })).expectNoFinding();
    h.given(rec({ HighContributions_CurrentYear: "abc" })).expectNoFinding();
    h.given(rec({ HighContributions_CurrentYear: "-0" })).expectNoFinding();
  });
});
