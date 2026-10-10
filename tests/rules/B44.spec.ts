import { describe, expect, it } from "vitest";
import { B44 } from "@/lib/rules/events/l2/B44";
import { cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B44);

describe("B44_AEDecreaseHOOPP / 1646 (INFORMATION, PRIVATE): AE down by more than $50,000", () => {
  it("CURRENT: 2026 AE ~20,000 vs 2025 75,000", () => {
    const f = h.given(cyBlock("2026-09-30", 38, 20000)).expectFinding({ messageId: "1646", yearScope: "CURRENT", params: {}, calculated: { validationYear: 2026 }, dataImportMessage: "Verify Earnings decrease greater than $50000" });
    expect(f.severity).toBe("INFORMATION");
    expect(f.visibility).toBe("PRIVATE");
  });
  it("PREVIOUS: 2025 ~20,000 vs 2024 72,000", () => {
    h.given(pyBlock(2025, 52, 20000), [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", calculated: { validationYear: 2025 } });
  });
  it("a $5,000 drop is B43 territory, not B44", () => {
    h.given(cyBlock("2026-09-30", 38, 70000)).expectNoFinding();
    h.given().expectNoFinding();
  });
});
