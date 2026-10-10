import { describe, expect, it } from "vitest";
import { B139 } from "@/lib/rules/events/l2/B139";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B139);
const retiree = stdMember({ emp: { otherInformation: "RetNotice 2026-06-30", terminationDate: "2026-06-30", terminationCode: "RET" } });

describe("B139_EmploymentEndDateSameAsInitiallyReported / 2492 (WARNING)", () => {
  it("warns when the RETFIN end date differs from the retirement date on file (MM-DD-YYYY in the message)", () => {
    const f = h.given({ EventType: "RETFIN", EmploymentEndDate: "07312026" }, [retiree]).expectFinding({ messageId: "2492", field: "EmploymentEndDate", params: { 0: "06-30-2026" }, calculated: { previousTerminationDate: "2026-06-30", employmentEndDate: "2026-07-31" } });
    expect(f.dataImportMessage.startsWith("The Employment End Date for this retirement was previously reported as 06-30-2026.")).toBe(true);
    expect(f.overrideReasons).toEqual(["Yes, Employment End Date has changed from originally reported value."]);
  });
  it("stays quiet when the dates match, when the termination code is not RET, or for TERFIN/DECFIN", () => {
    h.given({ EventType: "RETFIN", EmploymentEndDate: "06302026" }, [retiree]).expectNoFinding();
    h.given({ EventType: "RETFIN", EmploymentEndDate: "07312026" }, [stdMember({ emp: { terminationDate: "2026-06-30", terminationCode: "TER" } })]).expectNoFinding();
    h.given({ EventType: "RETFIN", EmploymentEndDate: "07312026" }, [stdMember()]).expectNoFinding();
    h.given({ EmploymentEndDate: "07312026" }, [retiree]).expectNoFinding();
  });
});
