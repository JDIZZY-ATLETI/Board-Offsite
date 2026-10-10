import { describe, expect, it } from "vitest";
import { B40 } from "@/lib/rules/events/l2/B40";
import { cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B40);

describe("B40_AEIncrease / 1238 (WARNING): AE more than 15 % above the prior year", () => {
  it("CURRENT: 2026 AE ~90,000 vs 2025 AE 75,000 (+20 %)", () => {
    const f = h.given(cyBlock("2026-09-30", 38, 90000)).expectFinding({ messageId: "1238", yearScope: "CURRENT", calculated: { validationYear: 2026, previousAE: "75000.00", errorYear: 2026 } });
    expect(Number(f.params[1])).toBeGreaterThan(19.9);
    expect(Number(f.params[1])).toBeLessThan(20.1);
    expect(f.params[2]).toBe("75,000.00");
    expect(f.dataImportMessage).toMatch(/^The Annualized Earnings amount of \$89,99\d\.\d\d is \d+\.\d\d% greater than the prior year's Annualized Earnings of \$75,000\.00\./);
    expect(f.overrideReasons).toContain("Other - please provide explanation");
    expect(f.overrideReasons).toHaveLength(7);
  });
  it("PREVIOUS: previous-year file data vs the year before it in Ariel (2025 ~90,000 vs 2024 72,000)", () => {
    h.given(pyBlock(2025, 52, 90000), [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", calculated: { validationYear: 2025, previousAE: "72000.00" } });
  });
  it("an increase of exactly 15 % or less, a REPORT salary rate year, or no prior AE -> no warning", () => {
    h.given().expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 86250)).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 90000), [stdMember({}, [])]).expectNoFinding();
  });
  it("the percentage is configurable", () => {
    h.given(cyBlock("2026-09-30", 38, 86000), null, { overrides: [{ ruleId: "B40", key: "B40.pct", value: 0.1 }] }).expectFinding();
  });
});
