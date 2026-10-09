import { describe, it } from "vitest";
import { I1 } from "@/lib/rules/events/l1/I1";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I1);

describe("I1_InputDataNotProvided / 8233", () => {
  it("fires once per blank mandatory field with the field name as {1}", () => {
    h.given(rec({ LastName: "" })).expectFinding({ messageId: "8233", field: "LastName", params: { 1: "LastName" }, dataImportMessage: "LastName is a required field.", portalMessage: "A mandatory field was not provided in the data file." });
    h.given(rec({ FirstName: "   " })).expectFinding({ field: "FirstName" });
    h.given(rec({ EventType: "" })).expectFinding({ field: "EventType" });
    h.given(rec({ Weeks_CurrentYear: "" })).expectFinding({ field: "Weeks_CurrentYear" });
    h.given(rec({ LowContributions_CurrentYear: "" })).expectFinding({ field: "LowContributions_CurrentYear" });
    h.given(rec({ PA_CurrentYear: "" })).expectFinding({ field: "PA_CurrentYear" });
    h.given(rec({ LastName: "", FirstName: "" })).expectCount(2);
  });
  it("requires EmploymentEndDate for TERFIN and RETFIN only", () => {
    h.given(rec({ EventType: "TERFIN", EmploymentEndDate: "" })).expectFinding({ field: "EmploymentEndDate" });
    h.given(rec({ EventType: "RETFIN", EmploymentEndDate: "" })).expectFinding({ field: "EmploymentEndDate" });
    h.given(rec({ EventType: "DECFIN", EmploymentEndDate: "" })).expectNoFinding();
  });
  it("leaves SIN to I2 and ignores non-mandatory blanks", () => {
    h.given(rec({ SIN: "" })).expectNoFinding();
    h.given(rec({ HighContributions_CurrentYear: "", Weeks_PreviousYear: "", PA_PreviousYear: "" })).expectNoFinding();
  });
  it("does not fire on a complete record", () => {
    h.given(rec()).expectNoFinding();
  });
});
