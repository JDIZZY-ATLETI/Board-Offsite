import { describe, it } from "vitest";
import { B202 } from "@/lib/rules/events/l2/B202";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B202);

describe("B202_PersonValidateUnicityOfAddress / 6908", () => {
  it("rejects when Ariel already holds two addresses with the same effective start date", () => {
    h.given({}, [stdMember({ addresses: [{ effectiveStartDate: "2026-10-08" }, { effectiveStartDate: "2026-10-08" }] })]).expectFinding({ messageId: "6908", calculated: { effectiveStartDate: "2026-10-08", count: 2 }, dataImportMessage: "An address update has already been made for this member today. Please contact HOOPP for more information." });
  });
  it("distinct or no addresses are clean (Events never creates addresses)", () => {
    h.given().expectNoFinding();
    h.given({}, [stdMember({ addresses: [{ effectiveStartDate: "2015-03-02" }, { effectiveStartDate: "2026-10-08" }] })]).expectNoFinding();
    h.given({}, [stdMember({ addresses: [] })]).expectNoFinding();
  });
});
