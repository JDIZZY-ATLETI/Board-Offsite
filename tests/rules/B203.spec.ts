import { describe, it } from "vitest";
import { B203 } from "@/lib/rules/events/l2/B203";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B203);

describe("B203_StatusDateAndStatusCode / 619", () => {
  it("rejects a status without an effective date, and a date without a status", () => {
    h.given({}, [stdMember({ membership: { statusEffectiveDate: null } })]).expectFinding({ messageId: "619", calculated: { source: "ariel", status: "A", statusEffectiveDate: "" }, dataImportMessage: "There is an issue regarding the membership status for this member. Please contact HOOPP for more information." });
    h.given({}, [stdMember({ membership: { status: null } })]).expectFinding({ calculated: { status: "", statusEffectiveDate: "2015-03-02" } });
    h.given({}, [stdMember({ membership: { status: "" } })]).expectFinding();
  });
  it("a consistent membership (both set, or both empty) is clean", () => {
    h.given().expectNoFinding();
    h.given({}, [stdMember({ membership: { status: null, statusEffectiveDate: null } })]).expectNoFinding();
  });
});
