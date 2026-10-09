import { describe, it } from "vitest";
import { I3 } from "@/lib/rules/events/l1/I3";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I3);

describe("I3_MaximumMandatoryFieldsLength / 9519", () => {
  it("fires when a numeric field exceeds its max length including the decimal point", () => {
    h.given(rec({ Weeks_CurrentYear: "123.45" })).expectFinding({
      messageId: "9519",
      field: "Weeks_CurrentYear",
      yearScope: "CURRENT",
      params: { "File.FieldName": "Weeks_CurrentYear", "Max Length": 5 },
      dataImportMessage: "The field Weeks_CurrentYear exceeds the maximum acceptable length of 5 characters (including decimal point, if applicable).",
      portalMessage: "The field Weeks_CurrentYear exceeds the maximum acceptable length of 5 characters (including decimal point, if applicable).",
      calculated: { length: 6 },
    });
    h.given(rec({ LowContributions_CurrentYear: "123456.78" })).expectFinding({ field: "LowContributions_CurrentYear", params: { "File.FieldName": "LowContributions_CurrentYear", "Max Length": 8 } });
    h.given(rec({ HighContributions_PreviousYear: "123456.78" })).expectFinding({ field: "HighContributions_PreviousYear", yearScope: "PREVIOUS" });
    h.given(rec({ AnnualizedEarnings_CurrentYear: "1234567", Weeks_CurrentYear: "0.00" })).expectFinding({ field: "AnnualizedEarnings_CurrentYear", params: { "File.FieldName": "AnnualizedEarnings_CurrentYear", "Max Length": 6 } });
    h.given(rec({ PA_PreviousYear: "123456" })).expectFinding({ field: "PA_PreviousYear", params: { "File.FieldName": "PA_PreviousYear", "Max Length": 5 } });
  });
  it("accepts values at exactly the max length and ignores names", () => {
    h.given(rec({ Weeks_CurrentYear: "52.00", LowContributions_CurrentYear: "12345.78", PA_CurrentYear: "12345", AnnualizedEarnings_PreviousYear: "123456", Weeks_PreviousYear: "0.00" })).expectNoFinding();
    h.given(rec({ LastName: "A".repeat(80) })).expectNoFinding();
  });
});
