import { describe, it } from "vitest";
import { B205 } from "@/lib/rules/events/l2/B205";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B205);

describe("B205_SubStatusDateAndSubStatusCode / 1070", () => {
  it("rejects a sub-status without an effective date, and a date without a sub-status", () => {
    h.given({}, [stdMember({ membership: { subStatus: "NCT", subStatusEffectiveDate: null } })]).expectFinding({ messageId: "1070", calculated: { subStatus: "NCT", subStatusEffectiveDate: "" }, dataImportMessage: "There is an issue regarding the membership sub-status for this member. Please contact HOOPP for more information." });
    h.given({}, [stdMember({ membership: { subStatus: null, subStatusEffectiveDate: "2025-11-15" } })]).expectFinding({ calculated: { subStatus: "" } });
  });
  it("both set or both empty is clean", () => {
    h.given().expectNoFinding();
    h.given({}, [stdMember({ membership: { subStatus: "NCT", subStatusEffectiveDate: "2025-11-15" } })]).expectNoFinding();
  });
});
