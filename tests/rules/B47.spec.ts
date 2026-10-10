import { describe, expect, it } from "vitest";
import { B47 } from "@/lib/rules/events/l2/B47";
import { cyBlock, stdMember, ZERO_CY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B47);
const newcomer = (years: Array<{ year: number; ae: number; weeks?: number }> = []) => stdMember({ emp: { permanencyDate: "2025-01-05" } }, years);

describe("B47_AEAmount / 2990 (WARNING): AE outside 20,000..120,000 when no earlier AE history exists", () => {
  it("fires above the maximum for a member enrolled last year", () => {
    const f = h.given(cyBlock("2026-09-30", 38, 150000), [newcomer()]).expectFinding({ messageId: "2990", yearScope: "CURRENT", calculated: { min: 20000, max: 120000 } });
    expect(f.params[1]).toBe(2026);
    expect(f.dataImportMessage).toMatch(/^Please verify that the Annualized Earnings amount of \$(149,99\d|150,00\d)\.\d\d for 2026 is correct\.$/);
    expect(f.overrideReasons).toEqual(["The reported annualized earnings are correct."]);
  });
  it("fires below the minimum", () => {
    h.given(cyBlock("2026-09-30", 38, 15000), [newcomer()]).expectFinding({ calculated: { min: 20000 } });
  });
  it("history before EventYear-1 with a positive AE (incl. retro) exits the rule; a zero AE or a plausible amount is clean", () => {
    h.given(cyBlock("2026-09-30", 38, 150000)).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 150000), [stdMember({}, [{ year: 2024, ae: 50000 }])]).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 150000), [newcomer([{ year: 2025, ae: 140000, weeks: 51.4 }])]).expectFinding();
    h.given(cyBlock("2026-09-30", 38, 78000), [newcomer()]).expectNoFinding();
    h.given(ZERO_CY, [newcomer()]).expectNoFinding();
  });
  it("bounds are configurable", () => {
    h.given(cyBlock("2026-09-30", 38, 78000), [newcomer()], { overrides: [{ ruleId: "B47", key: "B47.max", value: 70000 }] }).expectFinding({ calculated: { max: 70000 } });
  });
});
