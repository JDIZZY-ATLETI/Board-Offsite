import { describe, it } from "vitest";
import { B2 } from "@/lib/rules/events/l2/B2";
import { employment, member, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B2);

describe("B2_RejectMemberCreation / 1418", () => {
  it("rejects a SIN unknown to Ariel", () => {
    h.given({}, []).expectFinding({ messageId: "1418", field: "SIN", calculated: { reason: "MEMBER_NOT_FOUND" }, dataImportMessage: "This SIN does not match any members at your organization. If this is a new enrolment, please complete the Enrolment for this member." });
  });
  it("rejects a member with no employment at the reporting employer", () => {
    h.given({}, [member({ employments: [employment({ employerId: "0359" })] })]).expectFinding({ field: "SIN", calculated: { reason: "NO_EMPLOYMENT_AT_EMPLOYER", employerId: "0235" } });
  });
  it("accepts a member employed at the reporting employer (any of several members sharing the SIN)", () => {
    h.given({}, [stdMember()]).expectNoFinding();
    h.given({}, [member({ employments: [employment({ employerId: "0359" })] }), stdMember()]).expectNoFinding();
  });
  it("does not apply to a row without a SIN (I2 owns that)", () => {
    h.given({ SIN: "" }, []).expectNoFinding();
  });
});
