import { describe, it } from "vitest";
import { B19b } from "@/lib/rules/events/l2/B19b";
import { brk, salaryRate, stdMember, ZERO_CY, ZERO_PY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";
import type { ArielEmployment } from "@/types";

const h = l2Harness(B19b);
type D = `${number}-${number}-${number}`;
const wso = (start: D, end: D | null = null, extra: Partial<ArielEmployment> = {}) => stdMember({ emp: { serviceBreaks: [brk("WSO", start, end)], ...extra } });

describe("B19b_Annualized_Earnings_Have_Not_Be_Reported / 2955 (CY + PY)", () => {
  it("CURRENT: a WSO break covers the period but AE is blank or zero", () => {
    h.given(ZERO_CY, [wso("2026-01-01")]).expectFinding({ messageId: "2955", yearScope: "CURRENT", field: "AnnualizedEarnings_CurrentYear", params: { 1: 2026 }, calculated: { wsoStart: "2026-01-01", wsoEnd: "open" }, dataImportMessage: "Annualized earnings for 2026 must be provided for this member." });
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "0" }, [wso("2015-03-02", "2026-12-31")]).expectFinding({ yearScope: "CURRENT" });
  });
  it("PREVIOUS: previous-year block present without AE, no REPORT rate for that year, WSO covering the year", () => {
    h.given(ZERO_PY, [wso("2024-06-01", "2026-01-01")]).expectFinding({ yearScope: "PREVIOUS", field: "AnnualizedEarnings_PreviousYear", params: { 1: 2025 } }).yearScope;
    h.given(ZERO_PY, [wso("2024-06-01", "2026-01-01")]).expectCount(1);
    h.given(ZERO_PY, [wso("2024-06-01", "2026-01-01", { salaryRates: [salaryRate(2025, 70000)] })]).expectNoFinding();
    h.given(ZERO_PY, [stdMember({ emp: { serviceBreaks: [brk("WSO", "2025-01-01", "2026-01-01")], permanencyDate: "2026-01-04" } }, [])]).expectNoFinding();
    h.given({}, [wso("2024-06-01", "2026-01-01")]).expectNoFinding();
  });
  it("accepts when AE is reported, or when no WSO break covers the window", () => {
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "50000" }, [wso("2026-01-01")]).expectNoFinding();
    h.given(ZERO_CY, [wso("2026-02-01")]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
