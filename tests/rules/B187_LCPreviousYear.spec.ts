import { describe, it } from "vitest";
import { B187_LCPreviousYear } from "@/lib/rules/events/l1/B187";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(B187_LCPreviousYear);

describe("B187_LCPreviousYear / 494", () => {
  it("fires when LowContributions_PreviousYear is negative", () => {
    h.given(rec({ LowContributions_PreviousYear: "-3.50" })).expectFinding({ messageId: "494", field: "LowContributions_PreviousYear", yearScope: "PREVIOUS", params: { 0: "-3.50" }, dataImportMessage: "Negative value cannot be reported for -3.50.", portalMessage: "Negative value cannot be reported for Low Contributions previous year." });
  });
  it("does not fire for zero, positive, blank or non-numeric values", () => {
    h.given(rec({ LowContributions_PreviousYear: "0.00" })).expectNoFinding();
    h.given(rec({ LowContributions_PreviousYear: "12.50" })).expectNoFinding();
    h.given(rec({ LowContributions_PreviousYear: "" })).expectNoFinding();
    h.given(rec({ LowContributions_PreviousYear: "abc" })).expectNoFinding();
    h.given(rec({ LowContributions_PreviousYear: "-0" })).expectNoFinding();
  });
});
