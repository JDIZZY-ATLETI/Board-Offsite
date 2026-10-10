import { describe, it } from "vitest";
import { B186a } from "@/lib/rules/events/l2/B186a";
import { brk, cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B186a);
const noMdc25 = (emp = {}) => stdMember({ emp }, [{ year: 2024, ae: 72000 }]);

describe("B186a_Message / 573 (CY + PY): full-year shortfall beyond one week (section 18 Q10)", () => {
  it("PREVIOUS: 40 of 52 weeks", () => {
    h.given(pyBlock(2025, 40, 75000), [noMdc25()]).expectFinding({ messageId: "573", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025, 3: "52.00" }, calculated: { minimumService: "51.00", reportedService: "40.00" } });
    h.given(pyBlock(2025, 50.99, 75000), [noMdc25()]).expectFinding({ yearScope: "PREVIOUS" });
  });
  it("PREVIOUS: non-contributory leaves lower the expectation (PAR 2025-02-01..2025-08-01 = 181 days -> 26.21, ROUNDDOWN)", () => {
    h.given(pyBlock(2025, 25.21, 75000), [noMdc25({ serviceBreaks: [brk("PAR", "2025-02-01", "2025-08-01")] })]).expectNoFinding();
    h.given(pyBlock(2025, 25.2, 75000), [noMdc25({ serviceBreaks: [brk("PAR", "2025-02-01", "2025-08-01")] })]).expectFinding({ params: { 2: 2025, 3: "26.21" }, calculated: { carveOutDays: 181 } });
  });
  it("CURRENT: full-year event", () => {
    h.given(cyBlock("2026-12-31", 30, 78000)).expectFinding({ yearScope: "CURRENT", params: { 2: 2026, 3: "52.00" } });
  });
  it("51 weeks (= minimum), blank previous year, mid-year events are clean", () => {
    h.given(pyBlock(2025, 51, 75000), [noMdc25()]).expectNoFinding();
    h.given().expectNoFinding();
    h.given(cyBlock("2026-09-30", 5, 78000)).expectNoFinding();
  });
});
