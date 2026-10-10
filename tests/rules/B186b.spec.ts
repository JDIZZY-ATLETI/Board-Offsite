import { describe, it } from "vitest";
import { B186b } from "@/lib/rules/events/l2/B186b";
import { cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B186b);
const enrolled = (d: `${number}-${number}-${number}`) => stdMember({ emp: { permanencyDate: d } }, []);

describe("B186b_Message / 3466 (CY + PY): mid-year-enrolment shortfall (minimum = ES - 3.42)", () => {
  it("PREVIOUS: enrolled 2025-07-01 -> 26.21 expected (ROUNDDOWN), minimum 22.79; 10 reported", () => {
    h.given({ ...cyBlock("2026-09-30", 38, 75000), ...pyBlock(2025, 10, 75000) }, [enrolled("2025-07-01")]).expectFinding({ messageId: "3466", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025, 3: "26.21" }, calculated: { minimumService: "22.79", tolerance: -3.42 } });
    h.given({ ...cyBlock("2026-09-30", 38, 75000), ...pyBlock(2025, 22.78, 75000) }, [enrolled("2025-07-01")]).expectFinding({ yearScope: "PREVIOUS" });
  });
  it("CURRENT: enrolled in the event year with a Dec 31 event", () => {
    h.given(cyBlock("2026-12-31", 10, 66000), [enrolled("2026-03-16")]).expectFinding({ yearScope: "CURRENT", params: { 2: 2026, 3: "41.45" } });
  });
  it("no finding at/above the minimum, when the event ends the year early, or for members enrolled before the year", () => {
    h.given({ ...cyBlock("2026-09-30", 38, 75000), ...pyBlock(2025, 22.79, 75000) }, [enrolled("2025-07-01")]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 5, 66000), [enrolled("2026-03-16")]).expectNoFinding();
    h.given(cyBlock("2026-12-31", 10, 78000)).expectNoFinding();
  });
});
