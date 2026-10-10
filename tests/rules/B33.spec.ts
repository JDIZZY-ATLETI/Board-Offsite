import { describe, expect, it } from "vitest";
import { B33 } from "@/lib/rules/events/l2/B33";
import { contrib, ctsrv, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B33);
const PT = { employmentType: "PT" as const, employmentTypeHistory: [{ type: "PT" as const, effectiveDate: "2015-03-02" as const }] };

describe("B33_Message / 5001 (WARNING, CY + PY)", () => {
  it("CURRENT: part-time member with an RPPLOW contribution targeting the termination year (section 18 Q7)", () => {
    const f = h.given({}, [stdMember({ emp: { ...PT, contributions: [contrib(2026, "RPPLOW", 50, { summaryAttribute: "RCL" })] } }, [])]).expectFinding({ messageId: "5001", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 1: 2026 }, calculated: { trigger: "RPPLOW", summaryAttribute: "RCL" }, dataImportMessage: "Lump Sum Contributions for 2026 were previously reported for this member. Please verify that this service has been EXCLUDED. Select an override reason to continue." });
    expect(f.overrideReasons).toEqual(["Reported service does not include service for contributory leave."]);
  });
  it("CURRENT: lump-sum service (RCL / RPREYAD / RRETRO) targeting the year also triggers", () => {
    for (const attr of ["RCL", "RPREYAD", "RRETRO"]) {
      h.given({}, [stdMember({ emp: { ...PT, service: [ctsrv(2026, 2, { summaryAttribute: attr })] } }, [])]).expectFinding({ yearScope: "CURRENT", calculated: { trigger: "CTSRV", summaryAttribute: attr } });
    }
  });
  it("PREVIOUS: a part-time member with 2025 contributions on file (M12) warns for the previous year", () => {
    h.given({}, [stdMember({ emp: PT }, [{ year: 2025, ae: 54000, weeks: 26 }])]).expectFinding({ yearScope: "PREVIOUS", params: { 1: 2025 } });
    h.given({}, [stdMember({ emp: { employmentTypeHistory: [{ type: "FT", effectiveDate: "2015-03-02" }, { type: "PT", effectiveDate: "2025-06-01" }, { type: "FT", effectiveDate: "2026-01-01" }] } }, [{ year: 2025, ae: 54000, weeks: 26 }])]).expectFinding({ yearScope: "PREVIOUS" });
  });
  it("full-time members and part-time members without lump sums are clean", () => {
    h.given().expectNoFinding();
    h.given({}, [stdMember({ emp: PT }, [])]).expectNoFinding();
    h.given({}, [stdMember({ emp: { ...PT, service: [ctsrv(2026, 2, { summaryAttribute: "Final Data - Events" })] } }, [])]).expectNoFinding();
  });
});
