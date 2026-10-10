import { describe, expect, it } from "vitest";
import { B31 } from "@/lib/rules/events/l2/B31";
import { cyBlock, stdMember, ZERO_CY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B31);
const enrolled = (d: `${number}-${number}-${number}`) => stdMember({ emp: { permanencyDate: d } }, []);
const dec = { ...cyBlock("2026-12-15", 0, 75000), ...ZERO_CY };

describe("B31 / 7309 (WARNING with mandatory override - section 18 Q6)", () => {
  it("fires for a member enrolled Dec 8-31 of the execution year who reports zero weeks", () => {
    const f = h.given(dec, [enrolled("2026-12-10")]).expectFinding({ messageId: "7309", yearScope: "CURRENT", field: "Weeks_CurrentYear", calculated: { permanencyDate: "2026-12-10", windowStart: "2026-12-08" } });
    expect(f.severity).toBe("WARNING");
    expect(f.overrideReasons).toEqual(["The member enrolled in the last pay period of the reporting year and contributions will be reported in the next MDC reporting period."]);
    h.given(dec, [enrolled("2026-12-08")]).expectFinding();
    h.given(dec, [enrolled("2026-12-31")], { executionDate: "2026-12-31" }).expectFinding();
  });
  it("stays quiet with weeks > 0, an enrolment before the window, or an enrolment in another year", () => {
    h.given(cyBlock("2026-12-15", 1, 75000), [enrolled("2026-12-10")]).expectNoFinding();
    h.given(dec, [enrolled("2026-12-07")]).expectNoFinding();
    h.given(dec, [enrolled("2025-12-15")]).expectNoFinding();
    h.given().expectNoFinding();
  });
  it("the window start is a tolerance (B31.windowStart)", () => {
    h.given(dec, [enrolled("2026-12-01")], { overrides: [{ ruleId: "B31", key: "B31.windowStart", value: "12-01" }] }).expectFinding({ calculated: { windowStart: "2026-12-01" } });
  });
});
