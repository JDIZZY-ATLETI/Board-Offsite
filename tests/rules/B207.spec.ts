import { describe, it } from "vitest";
import { B207 } from "@/lib/rules/events/l2/B207";
import { pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";
import type { ArielPensionAdjustment } from "@/types";

const h = l2Harness(B207);
const pa = (over: Partial<ArielPensionAdjustment> = {}): ArielPensionAdjustment => ({ paId: "pa-1", employerId: "0235", calculationYear: 2026, amount: 7000, calculationDate: "2026-09-30", entryDate: "2026-10-08", ...over });

describe("B207_DuplicatePensionAdjustment / 2153 (CY + PY)", () => {
  it("CURRENT: a PA for the same employer/year entered on the execution date already exists", () => {
    h.given({}, [stdMember({ pensionAdjustments: [pa()] })]).expectFinding({ messageId: "2153", yearScope: "CURRENT", field: "PA_CurrentYear", calculated: { existingPaId: "pa-1", existingAmount: 7000, entryDate: "2026-10-08" } });
  });
  it("PREVIOUS: same for a previous-year PA", () => {
    h.given(pyBlock(2025, 52, 75000), [stdMember({ pensionAdjustments: [pa({ calculationYear: 2025 })] }, [{ year: 2024, ae: 72000 }])]).expectFinding({ yearScope: "PREVIOUS", field: "PA_PreviousYear" });
  });
  it("another entry date, another employer, another year, or no PA in the file -> clean", () => {
    h.given({}, [stdMember({ pensionAdjustments: [pa({ entryDate: "2026-10-07" })] })]).expectNoFinding();
    h.given({}, [stdMember({ pensionAdjustments: [pa({ employerId: "0359" })] })]).expectNoFinding();
    h.given({}, [stdMember({ pensionAdjustments: [pa({ calculationYear: 2025 })] })]).expectNoFinding();
    h.given({ PA_CurrentYear: "" }, [stdMember({ pensionAdjustments: [pa()] })]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
