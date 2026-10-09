import { describe, it } from "vitest";
import { I8 } from "@/lib/rules/events/l1/I8";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I8);

describe("I8_InvalidInteger / 5131", () => {
  it("fires for decimals, negatives and text in integer fields", () => {
    h.given(rec({ PA_CurrentYear: "12.5" })).expectFinding({ messageId: "5131", field: "PA_CurrentYear", params: { 1: "12.5" }, dataImportMessage: "12.5 is in an invalid number format. Please provide an integer value.", portalMessage: "The integer value is in an invalid number format. Please provide an integer value." });
    h.given(rec({ AnnualizedEarnings_PreviousYear: "-100", Weeks_PreviousYear: "" })).expectFinding({ field: "AnnualizedEarnings_PreviousYear", params: { 1: "-100" } });
    h.given(rec({ PA_PreviousYear: "1e3" })).expectFinding({ field: "PA_PreviousYear" });
  });
  it("never echoes the SIN value", () => {
    h.given(rec({ SIN: "12345678X" })).expectFinding({ field: "SIN", params: { 1: "SIN" }, calculated: { masked: true }, dataImportMessage: "SIN is in an invalid number format. Please provide an integer value." });
  });
  it("accepts whole numbers and short SINs (left-padded by the layout rule)", () => {
    h.given(rec({ PA_CurrentYear: "0", AnnualizedEarnings_CurrentYear: "53000", Weeks_CurrentYear: "0.00", SIN: "1234567" })).expectNoFinding();
  });
});
