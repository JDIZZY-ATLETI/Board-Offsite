import { describe, it } from "vitest";
import { B192a } from "@/lib/rules/events/l2/B192a";
import { ctsrv, pyBlock, stdMember, ZERO_PY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B192a);

describe("B192a_DuplicateMDCdataReceivedinEventsFile / 405 (CY + PY)", () => {
  it("PREVIOUS: previous-year data while MDC Core Data for that year is already in Ariel", () => {
    h.given(pyBlock(2025, 52, 75000)).expectFinding({ messageId: "405", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 0: 2025 }, calculated: { mdcWeeks: "52.0000" }, dataImportMessage: "Data for 2025 has already been reported. Please remove this data to continue.  If you need to adjust what was previously reported please contact HOOPP." });
  });
  it("CURRENT: current-year data while MDC Core Data for the event year is already in Ariel (dash-insensitive summary match)", () => {
    h.given({}, [stdMember({ emp: { service: [ctsrv(2026, 10, { summaryAttribute: "MDC - Core Data" })] } })]).expectFinding({ yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 0: 2026 } });
  });
  it("does not fire for zero/blank blocks, for non-MDC service, or when the year was never collected", () => {
    h.given().expectNoFinding();
    h.given(ZERO_PY).expectNoFinding();
    h.given(pyBlock(2025, 52, 75000), [stdMember({}, [{ year: 2024, ae: 72000 }])]).expectNoFinding();
    h.given({}, [stdMember({ emp: { service: [ctsrv(2026, 10, { summaryAttribute: "Final Data - Events" })] } })]).expectNoFinding();
  });
});
