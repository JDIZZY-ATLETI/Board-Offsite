import { describe, it } from "vitest";
import { I55 } from "@/lib/rules/events/l1/I55";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I55);

describe("I55_Zero_Weeks_And_Zero_LowContributions_Provided / 9349", () => {
  it("fires when weeks > 0 and low contributions = 0, per year scope", () => {
    h.given(rec({ Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: "0" })).expectFinding({ messageId: "9349", yearScope: "CURRENT", field: "LowContributions_CurrentYear", dataImportMessage: "You have provided weeks for this member, please provide associated contributions.", portalMessage: "You have provided weeks for this member, please provide associated contributions." });
    h.given(rec({ Weeks_PreviousYear: "52.00", LowContributions_PreviousYear: "0.00" })).expectFinding({ yearScope: "PREVIOUS" });
  });
  it("does not fire for zero weeks, positive contributions or blank contributions", () => {
    h.given(rec({ Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: "0.01" })).expectNoFinding();
    h.given(rec({ Weeks_PreviousYear: "52.00", LowContributions_PreviousYear: "" })).expectNoFinding();
  });
});
