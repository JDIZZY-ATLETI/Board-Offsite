import { describe, it } from "vitest";
import { B187_WeeksPreviousYear } from "@/lib/rules/events/l1/B187";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(B187_WeeksPreviousYear);

describe("B187_WeeksPreviousYear / 7902", () => {
  it("fires when Weeks_PreviousYear is negative", () => {
    h.given(rec({ Weeks_PreviousYear: "-2" })).expectFinding({ messageId: "7902", field: "Weeks_PreviousYear", yearScope: "PREVIOUS", params: { 0: "-2" }, dataImportMessage: "Negative value cannot be reported for -2.", portalMessage: "Negative value cannot be reported for Weeks previous year." });
  });
  it("does not fire for zero, positive, blank or non-numeric values", () => {
    h.given(rec({ Weeks_PreviousYear: "0.00" })).expectNoFinding();
    h.given(rec({ Weeks_PreviousYear: "12.50" })).expectNoFinding();
    h.given(rec({ Weeks_PreviousYear: "" })).expectNoFinding();
    h.given(rec({ Weeks_PreviousYear: "abc" })).expectNoFinding();
    h.given(rec({ Weeks_PreviousYear: "-0" })).expectNoFinding();
  });
});
