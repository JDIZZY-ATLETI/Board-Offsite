import { describe, expect, it } from "vitest";
import { B53b } from "@/lib/rules/events/l2/B53b";
import { brk, ctsrv, cyBlock, stdMember, ZERO_CY, type MdcYearSpec } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";
import type { ArielEmployment, ArielSalaryRate } from "@/types";

const h = l2Harness(B53b);
const faRate = (year: number): ArielSalaryRate => ({ txId: `fa-${year}`, type: "FARATE", rate: "70000.00", effectiveDate: `${year}-01-01`, entryDate: null, indicator: "PRV", summaryAttribute: "FA" });
const acw = ctsrv(2025, "0.0027", { type: "ACW", beginDate: "2025-01-01", endDate: "2025-01-01", targetDate: "2025-01-01", summaryAttribute: "ACW factor" });
const ltdMember = (emp: Partial<ArielEmployment>, years: MdcYearSpec[] = [{ year: 2024, ae: 72000 }]) => stdMember({ emp }, years);

describe("B53b / 7375 (Events) - 8795 (Events_LTD): LTD member PA must equal the calculated PA", () => {
  it("situation 1 (LTD starts mid-year, no FARATE): AE from contributions -> 7375", () => {
    const f = h.given({ ...cyBlock("2026-09-30", 17, 75000), PA_CurrentYear: "1000" }, [ltdMember({ serviceBreaks: [brk("LTD", "2026-05-01")] }, [{ year: 2024, ae: 72000 }, { year: 2025, ae: 75000 }])]).expectFinding({ messageId: "7375", yearScope: "CURRENT", field: "PA_CurrentYear", calculated: { situation: 1, reportedPA: 1000, acwSource: "n/a", ltdStart: "2026-05-01", ltdEnd: "open" }, portalMessage: "Reported PA with disability service not in line." });
    expect(f.params).toMatchObject({ 2: "PA", 3: 2026 });
    expect(f.dataImportMessage).toMatch(/^The PA for 2026 with disability service is incorrect based on the data provided\. The HOOPP calculated value is \d+\.$/);
  });
  it("situation 2 (LTD covers the whole year, FARATE on file): free-accrual service from the stored ACW factor -> 8795", () => {
    const m = ltdMember({ serviceBreaks: [brk("LTD", "2025-01-01")], salaryRates: [faRate(2025), faRate(2026)], service: [acw] });
    h.given({ ...cyBlock("2026-06-30", 0, 75000), ...ZERO_CY, PA_CurrentYear: "5000" }, [m]).expectFinding({ messageId: "8795", calculated: { situation: 2, acwSource: "stored", contributoryService: "0.0000" } });
    // Without an ACW transaction there is no free-accrual service: the calculated PA is 0 and a reported 0 matches.
    h.given({ ...cyBlock("2026-06-30", 0, 75000), ...ZERO_CY, PA_CurrentYear: "0" }, [ltdMember({ serviceBreaks: [brk("LTD", "2025-01-01")], salaryRates: [faRate(2026)] })]).expectNoFinding();
    h.given({ ...cyBlock("2026-06-30", 0, 75000), ...ZERO_CY, PA_CurrentYear: "5000" }, [ltdMember({ serviceBreaks: [brk("LTD", "2025-01-01")], salaryRates: [faRate(2026)] })]).expectFinding({ messageId: "8795", calculated: { acwSource: "ACW_MISSING" } });
  });
  it("situation 3 (LTD ends within the year): blended AE -> 8795", () => {
    const m = ltdMember({ serviceBreaks: [brk("LTD", "2025-06-01", "2026-04-01")], salaryRates: [faRate(2026)], service: [acw] }, [{ year: 2024, ae: 72000 }, { year: 2025, ae: 75000, weeks: 20 }]);
    h.given({ ...cyBlock("2026-09-30", 20, 75000), PA_CurrentYear: "100" }, [m]).expectFinding({ messageId: "8795", calculated: { situation: 3 } });
  });
  it("years before 2017 use the provided FASRV transaction", () => {
    const m = ltdMember({ permanencyDate: "2010-01-04", serviceBreaks: [brk("LTD", "2016-01-01")], salaryRates: [faRate(2016)], service: [ctsrv(2016, "0.5000", { type: "FASRV", summaryAttribute: "Free accrual" })] }, []);
    h.given({ ...cyBlock("2016-12-31", 0, 60000), ...ZERO_CY, PA_CurrentYear: "100" }, [m]).expectFinding({ messageId: "8795", calculated: { acwSource: "FASRV", freeAccrualService: "0.5000" } });
  });
  it("members without an LTD break in the year, or without a PA, are not evaluated", () => {
    h.given({ PA_CurrentYear: "1000" }).expectNoFinding();
    h.given({ PA_CurrentYear: "" }, [ltdMember({ serviceBreaks: [brk("LTD", "2026-05-01")] })]).expectNoFinding();
  });
});
