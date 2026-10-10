import { describe, expect, it } from "vitest";
import { B38 } from "@/lib/rules/events/l2/B38";
import { pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B38);

describe("B38_Message / 480 (WARNING, CY + PY): high reported but low below calculated low less one week", () => {
  it("CURRENT: 38 weeks in 2026 -> floor 3,662.57 (3,761.56 - 98.99)", () => {
    const f = h.given({ LowContributions_CurrentYear: "3000.00", HighContributions_CurrentYear: "300.00" }).expectFinding({ messageId: "480", yearScope: "CURRENT", field: "LowContributions_CurrentYear", params: { 1: 2026, 2: "3,662.57" }, calculated: { calculatedLow: "3761.56", reportedLow: "3000.00", high: "300.00" } });
    expect(f.severity).toBe("WARNING");
    expect(f.overrideReasons).toHaveLength(2);
    h.given({ LowContributions_CurrentYear: "3662.56", HighContributions_CurrentYear: "0.01" }).expectFinding();
  });
  it("PREVIOUS: 52 weeks in 2025 -> floor 4,825.09", () => {
    h.given({ ...pyBlock(2025, 52, 80000), LowContributions_PreviousYear: "4000.00" }, [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", params: { 1: 2025, 2: "4,825.09" } });
  });
  it("no high contributions, or low at/above the floor -> no warning", () => {
    h.given().expectNoFinding();
    h.given({ LowContributions_CurrentYear: "3000.00", HighContributions_CurrentYear: "" }).expectNoFinding();
    h.given({ LowContributions_CurrentYear: "3000.00", HighContributions_CurrentYear: "0.00" }).expectNoFinding();
    h.given({ LowContributions_CurrentYear: "3662.57", HighContributions_CurrentYear: "300.00" }).expectNoFinding();
  });
});
