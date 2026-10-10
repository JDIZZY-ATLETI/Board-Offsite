import { describe, it } from "vitest";
import { B19 } from "@/lib/rules/events/l2/B19";
import { brk, stdMember, ZERO_CY, ZERO_PY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B19);
const wso = (start: `${number}-${number}-${number}`, end: `${number}-${number}-${number}` | null = null) => stdMember({ emp: { serviceBreaks: [brk("WSO", start, end)] } });

describe("B19_Annualized_Earnings_Should_Not_Be_Reported / 9815 (CY + PY)", () => {
  it("CURRENT: AE reported without a waived-contribution (WSO) break covering the period", () => {
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "50000" }).expectFinding({ messageId: "9815", yearScope: "CURRENT", field: "AnnualizedEarnings_CurrentYear", calculated: { year: 2026 }, dataImportMessage: "Annualized earnings should not be reported for this member." });
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "50000" }, [wso("2026-02-01")]).expectFinding({ yearScope: "CURRENT" });
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "50000" }, [wso("2026-01-01", "2026-09-30")]).expectFinding({ yearScope: "CURRENT" });
  });
  it("PREVIOUS: previous-year AE without a WSO break covering the whole previous year", () => {
    h.given({ ...ZERO_PY, AnnualizedEarnings_PreviousYear: "50000" }).expectFinding({ yearScope: "PREVIOUS", field: "AnnualizedEarnings_PreviousYear", calculated: { year: 2025 } });
    h.given({ ...ZERO_PY, AnnualizedEarnings_PreviousYear: "50000" }, [wso("2024-12-01")]).expectNoFinding();
  });
  it("accepts AE with a covering WSO break, and rows without AE", () => {
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "50000" }, [wso("2026-01-01")]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
