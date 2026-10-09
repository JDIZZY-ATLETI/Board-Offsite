import { describe, it } from "vitest";
import { I32 } from "@/lib/rules/events/l1/I32";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I32);

describe("I32_Weeks_And_AnnualizedEarnings_Provided / 4999", () => {
  it("fires per year scope when weeks and AE are both > 0", () => {
    h.given(rec({ Weeks_CurrentYear: "38.00", AnnualizedEarnings_CurrentYear: "52000" })).expectFinding({ messageId: "4999", yearScope: "CURRENT", dataImportMessage: "Weeks and Annualized Earnings cannot both be greater than 0.", portalMessage: "Weeks and Annualized Earnings cannot both be greater than 0" });
    h.given(rec({ Weeks_PreviousYear: "52.00", AnnualizedEarnings_PreviousYear: "60000" })).expectFinding({ yearScope: "PREVIOUS" });
    h.given(rec({ AnnualizedEarnings_CurrentYear: "52000", AnnualizedEarnings_PreviousYear: "1" })).expectCount(2);
  });
  it("does not fire when either is zero, blank or unparseable", () => {
    h.given(rec({ Weeks_CurrentYear: "0.00", AnnualizedEarnings_CurrentYear: "52000" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "38.00", AnnualizedEarnings_CurrentYear: "0" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "38.00", AnnualizedEarnings_CurrentYear: "" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "abc", AnnualizedEarnings_CurrentYear: "52000" })).expectNoFinding();
  });
});
