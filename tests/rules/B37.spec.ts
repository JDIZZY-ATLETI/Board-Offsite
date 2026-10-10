import { describe, it } from "vitest";
import { B37 } from "@/lib/rules/events/l2/B37";
import { pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B37);

describe("B37_Message / 3029 (CY + PY): low contributions above YMPE x rate x weeks/52 + 2 weeks", () => {
  it("CURRENT: 38 weeks in 2026 -> maximum 3,959.54 (3,761.56 + 2 x 98.99)", () => {
    h.given({ LowContributions_CurrentYear: "6000.00" }).expectFinding({ messageId: "3029", yearScope: "CURRENT", field: "LowContributions_CurrentYear", params: { 1: 2026, 2: "3,959.54" }, calculated: { calculatedLow: "3761.56", reportedLow: "6000.00", ympe: "74600" }, dataImportMessage: "Low Contributions for reporting year 2026 cannot be greater than maximum amount of 3,959.54 for the weeks reported." });
    h.given({ LowContributions_CurrentYear: "3959.55" }).expectFinding();
  });
  it("PREVIOUS: 52 weeks in 2025 -> maximum 5,108.92", () => {
    h.given({ ...pyBlock(2025, 52, 75000), LowContributions_PreviousYear: "5500.00" }, [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", field: "LowContributions_PreviousYear", params: { 1: 2025, 2: "5,108.92" } });
  });
  it("accepts amounts within the tolerance and blocks without weeks or low", () => {
    h.given().expectNoFinding();
    h.given({ LowContributions_CurrentYear: "3959.53" }).expectNoFinding();
    h.given({ Weeks_CurrentYear: "", LowContributions_CurrentYear: "6000.00" }).expectNoFinding();
  });
  it("tolerance1Weeks is configurable", () => {
    h.given({ LowContributions_CurrentYear: "3900.00" }, null, { overrides: [{ ruleId: "B37", key: "B37.tolerance1Weeks", value: 1 }] }).expectFinding({ params: { 1: 2026, 2: "3,860.55" } });
  });
});
