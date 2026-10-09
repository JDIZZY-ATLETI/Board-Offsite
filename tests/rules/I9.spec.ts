import { describe, it } from "vitest";
import { I9 } from "@/lib/rules/events/l1/I9";
import { rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I9);

describe("I9_InvalidEnum / 8034 (adopted for EventType)", () => {
  it("fires for a code outside TERFIN/DECFIN/RETFIN", () => {
    h.given(rec({ EventType: "RETIRE" })).expectFinding({ messageId: "8034", field: "EventType", params: { 1: "RETIRE" }, dataImportMessage: "RETIRE is in an invalid code.", portalMessage: "The provided value is in an invalid code." });
    h.given(rec({ EventType: "terfin" })).expectFinding({ params: { 1: "terfin" } });
  });
  it("accepts the three codes and leaves blanks to I1", () => {
    for (const t of ["TERFIN", "DECFIN", "RETFIN"]) h.given(rec({ EventType: t })).expectNoFinding();
    h.given(rec({ EventType: "" })).expectNoFinding();
  });
});
