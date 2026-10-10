import { describe, it } from "vitest";
import { B184c } from "@/lib/rules/events/l2/B184c";
import { brk, cyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B184c);

describe("B184c_Excess ServiceTerminatedMidYear / 7854 (Events only, tolerance +3 weeks)", () => {
  it("CURRENT: Jan 1 .. Sep 30 = 273 days -> 38.90 weeks; 45 reported > 41.90", () => {
    h.given(cyBlock("2026-09-30", 45, 78000)).expectFinding({ messageId: "7854", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 2: 2026, 3: "38.90" }, calculated: { expectedService: "38.90", reportedService: "45.00", totalDays: 273, tolerance: 3 }, dataImportMessage: "In-year termination: Total Weeks reported for 2026 plus weeks previously reported exceed the 38.90 maximum possible weeks.         " });
    h.given(cyBlock("2026-09-30", 41.91, 78000)).expectFinding();
  });
  it("CURRENT: a break running past the termination is clipped at the event date (section 18 Q25)", () => {
    h.given(cyBlock("2026-09-30", 36, 78000), [stdMember({ emp: { serviceBreaks: [brk("WSO", "2026-07-01", null)] } })]).expectFinding({ calculated: { carveOutDays: 92, totalDays: 181 } });
  });
  it("within tolerance, full-year events and mid-year enrolments are not evaluated here", () => {
    h.given().expectNoFinding();
    h.given(cyBlock("2026-09-30", 41.9, 78000)).expectNoFinding();
    h.given(cyBlock("2026-12-31", 60, 78000)).expectNoFinding();
    h.given(cyBlock("2026-09-30", 60, 78000), [stdMember({ emp: { permanencyDate: "2026-02-01" } }, [])]).expectNoFinding();
  });
});
