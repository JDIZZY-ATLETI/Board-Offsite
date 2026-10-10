import { describe, it } from "vitest";
import { B192b } from "@/lib/rules/events/l2/B192b";
import { pyBlock, stdMember, ZERO_PY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B192b);
const noMdc25 = () => stdMember({}, [{ year: 2024, ae: 72000 }]);

describe("B192b_ReportingNoDataForPreviousYearEventsAndMDC-1WasNeverReceived / 7166", () => {
  it("rejects a blank previous year when last year's MDC was never received", () => {
    h.given({}, [noMdc25()]).expectFinding({ messageId: "7166", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 0: 2025 }, calculated: { permanencyYear: 2015 }, dataImportMessage: "Previous Year data for 2025 is required. If no contributions were made for 2025, please report zero weeks and contributions." });
  });
  it("names the first blank mandatory previous-year field", () => {
    h.given({ Weeks_PreviousYear: "0.00" }, [noMdc25()]).expectFinding({ field: "LowContributions_PreviousYear" });
    h.given({ Weeks_PreviousYear: "0.00", LowContributions_PreviousYear: "0.00" }, [noMdc25()]).expectFinding({ field: "PA_PreviousYear" });
  });
  it("zeros satisfy the rule (blank differs from 0); MDC on file or an enrolment in the event year also clears it", () => {
    h.given(ZERO_PY, [noMdc25()]).expectNoFinding();
    h.given(pyBlock(2025, 52, 75000), [noMdc25()]).expectNoFinding();
    h.given().expectNoFinding();
    h.given({}, [stdMember({ emp: { permanencyDate: "2026-03-16" } }, [])]).expectNoFinding();
  });
});
