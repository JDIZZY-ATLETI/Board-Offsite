import { describe, it } from "vitest";
import { B186c } from "@/lib/rules/events/l2/B186c";
import { cyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B186c);

describe("B186c_Shortfall / 9829 (Events only): mid-year termination with RS < 0.65 x ES", () => {
  it("CURRENT: Jan 1 .. Sep 30 -> 38.89 weeks (ROUNDDOWN), minimum 25.28; 5 reported", () => {
    h.given(cyBlock("2026-09-30", 5, 78000)).expectFinding({ messageId: "9829", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 2: 2026, 3: "38.89" }, calculated: { minimumService: "25.28", factor: 0.65, reportedService: "5.00" } });
    h.given(cyBlock("2026-09-30", 25.27, 78000)).expectFinding();
  });
  it("at/above the minimum, full-year events and mid-year enrolments are not evaluated here", () => {
    h.given(cyBlock("2026-09-30", 25.28, 78000)).expectNoFinding();
    h.given().expectNoFinding();
    h.given(cyBlock("2026-12-31", 1, 78000)).expectNoFinding();
    h.given(cyBlock("2026-09-30", 1, 66000), [stdMember({ emp: { permanencyDate: "2026-03-16" } }, [])]).expectNoFinding();
  });
  it("the factor is configurable", () => {
    h.given(cyBlock("2026-09-30", 30, 78000), null, { overrides: [{ ruleId: "B186c", key: "B186c.factor", value: 0.9 }] }).expectFinding({ calculated: { factor: 0.9 } });
  });
});
