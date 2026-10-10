import { describe, expect, it } from "vitest";
import { B41 } from "@/lib/rules/events/l2/B41";
import { cyBlock, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B41);

describe("B41AEIncreaseHOOPP / 6065 (INFORMATION, PRIVATE): AE more than 50 % above the prior year", () => {
  it("CURRENT: 2026 AE ~120,000 vs 75,000 (+60 %)", () => {
    const f = h.given(cyBlock("2026-09-30", 38, 120000)).expectFinding({ messageId: "6065", yearScope: "CURRENT", params: {}, calculated: { validationYear: 2026, previousAE: "75000.00" }, dataImportMessage: "Verify Earnings increase greater than 50%." });
    expect(f.severity).toBe("INFORMATION");
    expect(f.visibility).toBe("PRIVATE");
  });
  it("PREVIOUS scope", () => {
    h.given(pyBlock(2025, 52, 120000), [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", calculated: { validationYear: 2025 } });
  });
  it("a 20 % increase is B40 territory, not B41", () => {
    h.given(cyBlock("2026-09-30", 38, 90000)).expectNoFinding();
    h.given().expectNoFinding();
  });
});
