import { describe, it } from "vitest";
import { I5 } from "@/lib/rules/events/l1/I5";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I5);

describe("I5_InvalidDate / 825", () => {
  it("fires for non-numeric, wrong-format and impossible dates", () => {
    h.given(rec({ EmploymentEndDate: "2026-09-30" })).expectFinding({ messageId: "825", field: "EmploymentEndDate", params: { 1: "2026-09-30" }, dataImportMessage: "2026-09-30 is invalid. Date must be in MMDDYYYY format.", portalMessage: "The date value is invalid. Date must be in MMDDYYYY format." });
    h.given(rec({ EmploymentEndDate: "13312026" })).expectFinding({ params: { 1: "13312026" } });
    h.given(rec({ EmploymentEndDate: "02302026" })).expectFinding();
    h.given(rec({ EmploymentEndDate: "930202" })).expectFinding();
    h.given(rec({ EmploymentEndDate: "123120261" })).expectFinding();
  });
  it("accepts valid MMDDYYYY, left-padded short values and leap days", () => {
    h.given(rec({ EmploymentEndDate: "09302026" })).expectNoFinding();
    h.given(rec({ EmploymentEndDate: "1012026" })).expectNoFinding();
    h.given(rec({ EmploymentEndDate: "02292024" })).expectNoFinding();
    h.given(rec({ EmploymentEndDate: "" })).expectNoFinding();
  });
  it("also checks an optional DateOfDeath column", () => {
    h.given(rec({ DateOfDeath: "99999999" } as never)).expectFinding({ field: "DateOfDeath" });
  });
});
