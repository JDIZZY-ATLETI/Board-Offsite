import { describe, it } from "vitest";
import { B5 } from "@/lib/rules/events/l2/B5";
import { ctsrv, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B5);
const RET = { otherInformation: "RetNotice 2026-06-30", terminationDate: "2026-06-30" as const, terminationCode: "RET" as const };

describe("B5_MemberNotEligibleForThisDataUpdate / 5728", () => {
  it("TERFIN: rejects a member whose employment is already terminated (M4)", () => {
    h.given({}, [stdMember({ emp: { terminationDate: "2025-11-15", terminationCode: "TER" } })]).expectFinding({ messageId: "5728", field: "EventType", calculated: { reason: "ALREADY_TERMINATED", terminationCode: "TER" }, dataImportMessage: "This member is not eligible for this type of data collection/revision." });
  });
  it("RETFIN / DECFIN: rejects termination codes TER, DEC and AMA (M5)", () => {
    for (const code of ["TER", "DEC", "AMA"] as const) {
      h.given({ EventType: "RETFIN" }, [stdMember({ emp: { terminationDate: "2025-08-01", terminationCode: code } })]).expectFinding({ calculated: { reason: `TERMINATION_CODE_${code}` } });
      h.given({ EventType: "DECFIN" }, [stdMember({ emp: { terminationDate: "2025-08-01", terminationCode: code } })]).expectFinding({ calculated: { reason: `TERMINATION_CODE_${code}` } });
    }
  });
  it("RETFIN: rejects a retiree who already has CTSRV in the event year (M6), accepts one without (M6b)", () => {
    const h2 = stdMember({ emp: { ...RET, service: [ctsrv(2026, 8, { beginDate: "2026-01-01", endDate: "2026-02-28", targetDate: "2026-02-28", summaryAttribute: "Final Data - Events" })] } });
    h.given({ EventType: "RETFIN", EmploymentEndDate: "02282026" }, [h2]).expectFinding({ calculated: { reason: "RET_WITH_CTSRV_IN_YEAR", year: 2026 } });
    h.given({ EventType: "RETFIN", EmploymentEndDate: "06302026" }, [stdMember({ emp: RET })]).expectNoFinding();
    h.given({ EventType: "DECFIN", EmploymentEndDate: "06302026" }, [stdMember({ emp: RET })]).expectNoFinding();
  });
  it("TERFIN on an active employment is eligible; rows without an event date are not evaluated", () => {
    h.given().expectNoFinding();
    h.given({ EmploymentEndDate: "" }, [stdMember({ emp: { terminationDate: "2025-11-15", terminationCode: "TER" } })]).expectNoFinding();
  });
});
