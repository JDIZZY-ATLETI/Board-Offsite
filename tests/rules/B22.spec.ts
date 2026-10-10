import { describe, it } from "vitest";
import { B22 } from "@/lib/rules/events/l2/B22";
import { brk, pyBlock, stdMember, ZERO_CY, ZERO_PY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B22);
const ltd = (start: `${number}-${number}-${number}`, end: `${number}-${number}-${number}` | null = null) => stdMember({ emp: { serviceBreaks: [brk("LTD", start, end)] } }, [{ year: 2024, ae: 72000 }]);

describe("B22_MemberOnFreeAccrualEntireYearNoServiceRequired / 5604 (CY + PY)", () => {
  it("CURRENT: service/contributions/PA reported while an LTD break covers Jan 1 .. event date", () => {
    h.given({}, [ltd("2025-01-01")]).expectFinding({ messageId: "5604", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 2: 2026 }, calculated: { ltdStart: "2025-01-01", ltdEnd: "open" } });
    h.given({ ...ZERO_CY, PA_CurrentYear: "100" }, [ltd("2026-01-01", "2026-09-30")]).expectFinding({ yearScope: "CURRENT" });
  });
  it("PREVIOUS: previous-year service while LTD covered that year (PA alone does not count for PY)", () => {
    h.given(pyBlock(2025, 52, 75000), [ltd("2024-06-01")]).expectFinding({ yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025 } });
    h.given({ ...ZERO_PY, PA_PreviousYear: "100" }, [ltd("2024-06-01", "2025-12-31")]).expectNoFinding();
  });
  it("does not fire when the LTD break starts after Jan 1, ends before the event, or nothing is reported", () => {
    h.given({}, [ltd("2026-02-01")]).expectNoFinding();
    h.given({}, [ltd("2025-01-01", "2026-06-30")]).expectNoFinding();
    h.given(ZERO_CY, [ltd("2025-01-01")]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
