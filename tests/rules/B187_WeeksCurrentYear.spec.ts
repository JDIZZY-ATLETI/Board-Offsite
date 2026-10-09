import { describe, it } from "vitest";
import { B187_WeeksCurrentYear } from "@/lib/rules/events/l1/B187";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(B187_WeeksCurrentYear);

describe("B187_WeeksCurrentYear / 9099", () => {
  it("fires when Weeks_CurrentYear is negative", () => {
    h.given(rec({ Weeks_CurrentYear: "-1.00" })).expectFinding({ messageId: "9099", field: "Weeks_CurrentYear", yearScope: "CURRENT", params: { 0: "-1.00" }, dataImportMessage: "Negative value cannot be reported for -1.00.", portalMessage: "Negative value cannot be reported for Weeks Current Year." });
  });
  it("does not fire for zero, positive, blank or non-numeric values", () => {
    h.given(rec({ Weeks_CurrentYear: "0.00" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "12.50" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "abc" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "-0" })).expectNoFinding();
  });
});
