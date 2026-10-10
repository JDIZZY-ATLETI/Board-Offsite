import { describe, it } from "vitest";
import { B184a } from "@/lib/rules/events/l2/B184a";
import { brk, cyBlock, ctsrv, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B184a);
const noMdc25 = (emp = {}) => stdMember({ emp }, [{ year: 2024, ae: 72000 }]);

describe("B184a_ExcessServiceEnrolledFullYear / 66 (CY + PY)", () => {
  it("PREVIOUS: 53 weeks reported for a full 2025 (maximum 52.00)", () => {
    h.given(pyBlock(2025, 53, 75000), [noMdc25()]).expectFinding({ messageId: "66", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025, 3: "52.00" }, calculated: { expectedService: "52.00", reportedService: "53.00", arielService: "0.00", suggestedWeeks: "52.00", carveOutDays: 0, totalYear: 365 } });
  });
  it("PREVIOUS: weeks already in Ariel count towards the total and reduce the suggested weeks", () => {
    h.given(pyBlock(2025, 10, 75000), [noMdc25({ service: [ctsrv(2025, 45, { summaryAttribute: "Retro" })] })]).expectFinding({ yearScope: "PREVIOUS", calculated: { reportedService: "55.00", arielService: "45.00", suggestedWeeks: "7.00" } });
  });
  it("PREVIOUS: LTD/NC* breaks carve the year down (61 days -> 43.31 weeks, ROUNDUP)", () => {
    h.given(pyBlock(2025, 50, 75000), [noMdc25({ serviceBreaks: [brk("LTD", "2025-03-01", "2025-05-01")] })]).expectFinding({ yearScope: "PREVIOUS", params: { 2: 2025, 3: "43.31" }, calculated: { carveOutDays: 61 } });
    h.given(pyBlock(2025, 43.31, 75000), [noMdc25({ serviceBreaks: [brk("LTD", "2025-03-01", "2025-05-01")] })]).expectNoFinding();
  });
  it("CURRENT: only when the event date is Dec 31 (full year)", () => {
    h.given(cyBlock("2026-12-31", 53, 78000)).expectFinding({ yearScope: "CURRENT", params: { 2: 2026, 3: "52.00" } });
    h.given(cyBlock("2026-09-30", 53, 78000)).expectNoFinding();
  });
  it("exact maximum, blank previous year and mid-year enrolments are clean", () => {
    h.given(pyBlock(2025, 52, 75000), [noMdc25()]).expectNoFinding();
    h.given().expectNoFinding();
    h.given(pyBlock(2025, 53, 75000), [stdMember({ emp: { permanencyDate: "2025-02-01" } }, [])]).expectNoFinding();
  });
});
