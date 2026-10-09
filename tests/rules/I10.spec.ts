import { describe, it } from "vitest";
import { I10 } from "@/lib/rules/events/l1/I10";
import { ctxOf, rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I10);

describe("I10_MultiplePersonEntries / 910", () => {
  it("rejects every row sharing a SIN, masking the SIN in the message", () => {
    const a = rec({}, 2);
    const b = rec({}, 3);
    const c = rec({ SIN: "900000027" }, 4);
    const ctx = ctxOf({ records: [a, b, c] });
    h.given(a, ctx).expectFinding({ messageId: "910", field: "SIN", params: { 1: "***-***-019" }, calculated: { occurrences: 2, masked: true }, dataImportMessage: "***-***-019 appears multiple times in file. Please review data for each instance and only submit one instance of correct data.", portalMessage: "This SIN appears multiple times in file. Please review data for each instance and only submit one instance of correct data." });
    h.given(b, ctx).expectFinding();
    h.given(c, ctx).expectNoFinding();
  });
  it("treats left-padded SINs as the same person", () => {
    const a = rec({ SIN: "1234567" }, 2);
    const b = rec({ SIN: "001234567" }, 3);
    h.given(a, ctxOf({ records: [a, b] })).expectFinding({ params: { 1: "***-***-567" } });
  });
  it("skips rows without a SIN", () => {
    const a = rec({ SIN: "" }, 2);
    const b = rec({ SIN: "" }, 3);
    h.given(a, ctxOf({ records: [a, b] })).expectNoFinding();
  });
});
