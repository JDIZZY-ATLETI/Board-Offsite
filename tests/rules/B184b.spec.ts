import { describe, it } from "vitest";
import { B184b } from "@/lib/rules/events/l2/B184b";
import { brk, cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B184b);
const enrolled = (d: `${number}-${number}-${number}`, emp = {}) => stdMember({ emp: { permanencyDate: d, ...emp } }, []);

describe("B184b_ExcessServiceEnrolledMidYear / 3002 (CY + PY)", () => {
  it("CURRENT: enrolled 2026-03-16, terminated 2026-09-30 -> 199 days -> 28.36 weeks maximum (M7)", () => {
    h.given(cyBlock("2026-09-30", 40, 66000), [enrolled("2026-03-16")]).expectFinding({ messageId: "3002", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 2: 2026, 3: "28.36" }, calculated: { totalDays: 199, carveOutDays: 0 } });
    h.given(cyBlock("2026-09-30", 27, 66000), [enrolled("2026-03-16")]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 28.36, 66000), [enrolled("2026-03-16")]).expectNoFinding();
  });
  it("CURRENT: breaks inside the window are carved out", () => {
    h.given(cyBlock("2026-09-30", 27, 66000), [enrolled("2026-03-16", { serviceBreaks: [brk("NCM", "2026-05-01", "2026-06-01")] })]).expectFinding({ calculated: { carveOutDays: 31, totalDays: 168 } });
  });
  it("PREVIOUS: enrolled 2025-07-01 -> 184 days of 2025 -> 26.22 weeks", () => {
    h.given({ ...cyBlock("2026-09-30", 38, 75000), ...pyBlock(2025, 30, 75000) }, [enrolled("2025-07-01")]).expectFinding({ yearScope: "PREVIOUS", params: { 2: 2025, 3: "26.22" } });
    h.given({ ...cyBlock("2026-09-30", 38, 75000), ...pyBlock(2025, 26, 75000) }, [enrolled("2025-07-01")]).expectNoFinding();
  });
  it("does not apply to members enrolled before the year", () => {
    h.given(cyBlock("2026-09-30", 53, 78000)).expectNoFinding();
  });
});
