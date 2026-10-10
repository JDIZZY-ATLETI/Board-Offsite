import { describe, expect, it } from "vitest";
import { B53a } from "@/lib/rules/events/l2/B53a";
import { brk, cyBlock, paFor, pyBlock, stdMember, ZERO_CY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B53a);
const pa = Number(paFor(2026, 78000, 38));

describe("B53a / 2160 (Events): PA within +/-250 of the HOOPP-calculated PA (non-LTD)", () => {
  it("CURRENT: reported PA 1,000 above the calculation", () => {
    const f = h.given({ PA_CurrentYear: String(pa + 1000) }).expectFinding({ messageId: "2160", yearScope: "CURRENT", field: "PA_CurrentYear", calculated: { reportedPA: pa + 1000, tolerance: 250 }, portalMessage: "Reported PA not in line." });
    expect(f.params[2]).toBe("PA");
    expect(f.params[3]).toBe(2026);
    expect(Math.abs(Number(f.params[4]) - pa)).toBeLessThanOrEqual(2);
    expect(f.dataImportMessage).toMatch(/^The PA for 2026 is incorrect based on the data provided\. The HOOPP calculated value is \d+\.$/);
    h.given({ PA_CurrentYear: String(pa - 251) }).expectFinding({ yearScope: "CURRENT" });
  });
  it("PREVIOUS: previous-year PA for a year not yet in Ariel", () => {
    const m = stdMember({}, [{ year: 2024, ae: 72000 }]);
    h.given({ ...pyBlock(2025, 52, 75000), PA_PreviousYear: String(Number(paFor(2025, 75000, 52)) + 1000) }, [m]).expectFinding({ yearScope: "PREVIOUS", field: "PA_PreviousYear" });
    h.given(pyBlock(2025, 52, 75000), [m]).expectNoFinding();
  });
  it("within tolerance, PA 0 with nothing reported, blank PA, and LTD years are not evaluated", () => {
    h.given().expectNoFinding();
    h.given({ PA_CurrentYear: String(pa + 200) }).expectNoFinding();
    h.given(ZERO_CY).expectNoFinding();
    h.given({ PA_CurrentYear: "" }).expectNoFinding();
    h.given({ PA_CurrentYear: String(pa + 1000) }, [stdMember({ emp: { serviceBreaks: [brk("LTD", "2026-05-01")] } })]).expectNoFinding();
  });
  it("tolerance is configurable", () => {
    h.given({ PA_CurrentYear: String(pa + 200) }, null, { overrides: [{ ruleId: "B53a", key: "B53a.pa", value: 100 }] }).expectFinding({ calculated: { tolerance: 100 } });
    h.given(cyBlock("2026-09-30", 38, 78000)).expectNoFinding();
  });
});
