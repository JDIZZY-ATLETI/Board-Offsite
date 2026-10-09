import { describe, it } from "vitest";
import { B187_LowContributionsCurrentYear } from "@/lib/rules/events/l1/B187";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(B187_LowContributionsCurrentYear);

describe("B187_LowContributionsCurrentYear / 4423", () => {
  it("fires when LowContributions_CurrentYear is negative", () => {
    h.given(rec({ LowContributions_CurrentYear: "-5" })).expectFinding({ messageId: "4423", field: "LowContributions_CurrentYear", yearScope: "CURRENT", params: { 0: "-5" }, dataImportMessage: "Negative value cannot be reported for -5.", portalMessage: "Negative value cannot be reported for Low Contributions current year." });
  });
  it("does not fire for zero, positive, blank or non-numeric values", () => {
    h.given(rec({ LowContributions_CurrentYear: "0.00" })).expectNoFinding();
    h.given(rec({ LowContributions_CurrentYear: "12.50" })).expectNoFinding();
    h.given(rec({ LowContributions_CurrentYear: "" })).expectNoFinding();
    h.given(rec({ LowContributions_CurrentYear: "abc" })).expectNoFinding();
    h.given(rec({ LowContributions_CurrentYear: "-0" })).expectNoFinding();
  });
});
