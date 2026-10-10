import { describe, it } from "vitest";
import { B204 } from "@/lib/rules/events/l2/B204";
import { stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B204);

describe("B204_PersonMatchingEntityInstance / 6279", () => {
  it("rejects when two Ariel members share the SIN", () => {
    h.given({}, [stdMember({ memberId: "mbr-a" }), stdMember({ memberId: "mbr-b", firstName: "Quinn" })]).expectFinding({ messageId: "6279", field: "SIN", calculated: { members: 2 }, dataImportMessage: "Duplicate SIN. Please contact HOOPP for more information." });
  });
  it("accepts a unique SIN", () => {
    h.given().expectNoFinding();
  });
});
