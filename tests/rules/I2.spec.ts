import { describe, it } from "vitest";
import { I2 } from "@/lib/rules/events/l1/I2";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I2);

describe("I2_InputIdentifierNotProvided / 2031", () => {
  it("fires when SIN is blank or whitespace", () => {
    h.given(rec({ SIN: "" })).expectFinding({ messageId: "2031", field: "SIN", dataImportMessage: "SIN is a mandatory field in the data file.", portalMessage: "SIN is a mandatory field in the data file." });
    h.given(rec({ SIN: "  " })).expectFinding({ field: "SIN" });
  });
  it("does not fire when SIN is present (even if malformed)", () => {
    h.given(rec()).expectNoFinding();
    h.given(rec({ SIN: "ABC" })).expectNoFinding();
  });
});
