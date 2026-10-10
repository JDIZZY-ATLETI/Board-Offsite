import { describe, it } from "vitest";
import { B113 } from "@/lib/rules/events/l2/B113";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B113);

describe("B113_NoRetirementNotice_Before_RETFIN / 9075", () => {
  it("rejects RETFIN when Ariel has no (well-formed) retirement notice", () => {
    h.given({ EventType: "RETFIN" }).expectFinding({ messageId: "9075", field: "EventType", calculated: { otherInformation: "" }, dataImportMessage: "A Notice of Retirement must be completed for this member before submitting final data." });
    h.given({ EventType: "RETFIN" }, [stdMember({ emp: { otherInformation: "RetNotice soon" } })]).expectFinding();
  });
  it("accepts RETFIN with a notice and ignores TERFIN/DECFIN", () => {
    h.given({ EventType: "RETFIN" }, [stdMember({ emp: { otherInformation: "RetNotice 2026-09-30", terminationDate: "2026-09-30", terminationCode: "RET" } })]).expectNoFinding();
    h.given().expectNoFinding();
    h.given({ EventType: "DECFIN" }).expectNoFinding();
  });
});
