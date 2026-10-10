import { describe, it } from "vitest";
import { B185 } from "@/lib/rules/events/l2/B185";
import { ctsrv, cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B185);
const noMdc25 = (emp = {}) => stdMember({ emp }, [{ year: 2024, ae: 72000 }]);

describe("B185_Message / 3506 (CY + PY): shortfall within one week must be rolled up", () => {
  it("PREVIOUS: 51.5 of 52 weeks -> adjust to 52.00", () => {
    h.given(pyBlock(2025, 51.5, 75000), [noMdc25()]).expectFinding({ messageId: "3506", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025, 3: "52.00" }, calculated: { reportedService: "51.50", suggestedWeeks: "52.00", tolerance: -1 }, dataImportMessage: "The Weeks reported for 2025 should be adjusted to 52.00. Contributions may not need to be adjusted if reported correctly.  " });
    h.given(pyBlock(2025, 51, 75000), [noMdc25()]).expectFinding({ yearScope: "PREVIOUS" });
  });
  it("PREVIOUS: REGUL service in Ariel counts towards the reported total", () => {
    h.given(pyBlock(2025, 50, 75000), [noMdc25({ service: [ctsrv(2025, 1.5, { indicator: "REGUL", summaryAttribute: "Adjustment" })] })]).expectFinding({ calculated: { reportedService: "51.50", arielService: "1.50", suggestedWeeks: "50.50" } });
  });
  it("CURRENT: full-year event (Dec 31)", () => {
    h.given(cyBlock("2026-12-31", 51.2, 78000)).expectFinding({ yearScope: "CURRENT", params: { 2: 2026, 3: "52.00" } });
  });
  it("exact service, a shortfall beyond one week (B186a territory), mid-year events and enrolments in the year are not B185", () => {
    h.given(pyBlock(2025, 52, 75000), [noMdc25()]).expectNoFinding();
    h.given(pyBlock(2025, 50.99, 75000), [noMdc25()]).expectNoFinding();
    h.given().expectNoFinding();
    h.given(pyBlock(2025, 25, 75000), [stdMember({ emp: { permanencyDate: "2025-01-01" } }, [])]).expectNoFinding();
  });
});
