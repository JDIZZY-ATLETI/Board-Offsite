import { describe, it } from "vitest";
import { B112 } from "@/lib/rules/events/l2/B112";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B112);
const noticed = stdMember({ emp: { otherInformation: "RetNotice 2026-06-30", terminationDate: "2026-06-30", terminationCode: "RET" } });

describe("B112_RetirementNotice_Before_TERFIN / 1616 (TERFIN) - 8112 (DECFIN)", () => {
  it("TERFIN after a retirement notice -> 1616 with {1/2} = Termination", () => {
    h.given({}, [noticed]).expectFinding({ messageId: "1616", field: "EventType", params: { "1/2": "Termination" }, dataImportMessage: "A retirement has been initiated for this member. To report final data for this member, please select \"Retirement\". To report a Termination for this member, please contact HOOPP." });
  });
  it("DECFIN after a retirement notice -> 8112 with {1/2} = Death", () => {
    h.given({ EventType: "DECFIN" }, [noticed]).expectFinding({ messageId: "8112", params: { "1/2": "Death" }, portalMessage: "A retirement has been initiated for this member. To report final data for this member, please select \"Retirement\". To report a Death for this member, please contact HOOPP." });
  });
  it("does not fire without a notice, nor for RETFIN", () => {
    h.given().expectNoFinding();
    h.given({}, [stdMember({ emp: { otherInformation: "Events 06302026" } })]).expectNoFinding();
    h.given({ EventType: "RETFIN" }, [noticed]).expectNoFinding();
  });
});
