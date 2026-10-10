import { describe, expect, it } from "vitest";
import { B214 } from "@/lib/rules/events/l2/B214";
import { brk, cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";
import type { ArielEmployment, ArielServiceBreak } from "@/types";

const h = l2Harness(B214);
const PT: Partial<ArielEmployment> = { employmentType: "PT", employmentTypeHistory: [{ type: "PT", effectiveDate: "2015-03-02" }] };
const pt = (breaks: ArielServiceBreak[], emp: Partial<ArielEmployment> = {}) => stdMember({ emp: { ...PT, serviceBreaks: breaks, ...emp } }, [{ year: 2024, ae: 52000, weeks: 26 }, { year: 2025, ae: 54000, weeks: 26 }]);

describe("B214 / 6012 (WARNING, CY + PY): part-time member with a non-contributory leave and weeks spilling into it", () => {
  it("CURRENT: NCP Feb 1 .. Apr 30 (88 days) in a Jan 1 .. Sep 30 period -> WCP 35.23; 38 weeks > 35.37", () => {
    const f = h.given(cyBlock("2026-09-30", 38, 54000), [pt([brk("NCP", "2026-02-01", "2026-04-30")])]).expectFinding({ messageId: "6012", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 1: 2026 }, calculated: { workingContributoryPeriod: "35.23", reportedWeeks: "38.00", leaveType: "NCP", carveOutDays: 88, spanDays: 273, tolerance: 0.14 } });
    expect(f.overrideReasons).toEqual(["Contributory leave data reported.", "Member did not contribute for this leave within the reporting period."]);
    h.given(cyBlock("2026-09-30", 35.38, 54000), [pt([brk("NCP", "2026-02-01", "2026-04-30")])]).expectFinding();
  });
  it("CURRENT: DECFIN ends the period on the date of death itself", () => {
    h.given({ ...cyBlock("2026-09-30", 38, 54000), EventType: "DECFIN" }, [pt([brk("NCP", "2026-02-01", "2026-04-30")])]).expectFinding({ calculated: { spanDays: 272 } });
  });
  it("PREVIOUS: leave in the previous year with previous-year weeks", () => {
    h.given({ ...cyBlock("2026-09-30", 10, 54000), ...pyBlock(2025, 25, 54000) }, [pt([brk("NCE", "2025-03-01", "2025-09-01")], { service: [], contributions: [] })]).expectNoFinding();
    h.given({ ...cyBlock("2026-09-30", 10, 54000), ...pyBlock(2025, 40, 54000) }, [pt([brk("NCE", "2025-03-01", "2025-09-01")], { service: [], contributions: [] })]).expectFinding({ yearScope: "PREVIOUS", params: { 1: 2025 }, calculated: { leaveType: "NCE", carveOutDays: 184, workingContributoryPeriod: "25.78" } });
  });
  it("full-time members, leaves shorter than 5 days, non-leave breaks and weeks within the period are clean", () => {
    h.given(cyBlock("2026-09-30", 38, 54000), [stdMember({ emp: { serviceBreaks: [brk("NCP", "2026-02-01", "2026-04-30")] } })]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 54000), [pt([brk("NCP", "2026-02-01", "2026-02-04")])]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 54000), [pt([brk("LTD", "2026-02-01", "2026-04-30")])]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 35.37, 54000), [pt([brk("NCP", "2026-02-01", "2026-04-30")])]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 54000), [pt([])]).expectNoFinding();
  });
});
