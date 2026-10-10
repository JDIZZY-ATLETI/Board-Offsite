import { describe, expect, it } from "vitest";
import { B43 } from "@/lib/rules/events/l2/B43";
import { cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B43);

describe("B43_AEDecrease / 5613 (WARNING): AE down by more than $2,500", () => {
  it("CURRENT: 2026 AE ~70,000 vs 2025 75,000 (-5,000)", () => {
    const f = h.given(cyBlock("2026-09-30", 38, 70000)).expectFinding({ messageId: "5613", yearScope: "CURRENT", calculated: { validationYear: 2026, previousAE: "75000.00" } });
    expect(f.params[2]).toBe("75,000.00");
    expect(f.dataImportMessage).toMatch(/^The Annualized Earnings amount of \$(69,99\d|70,00\d)\.\d\d has decreased by \$(4,99\d|5,00\d)\.\d\d from the prior year's Annualized Earnings of \$75,000\.00\./);
    expect(f.overrideReasons).toHaveLength(6);
  });
  it("PREVIOUS: 2025 ~60,000 vs 2024 72,000", () => {
    h.given(pyBlock(2025, 52, 60000), [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", calculated: { validationYear: 2025, previousAE: "72000.00" } });
  });
  it("a drop of $2,500 or less, or no prior year, is not a warning", () => {
    h.given().expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 73000)).expectNoFinding();
    h.given(cyBlock("2026-09-30", 38, 70000), [stdMember({}, [])]).expectNoFinding();
  });
});
