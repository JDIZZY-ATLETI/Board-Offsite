import { describe, it } from "vitest";
import { I50 } from "@/lib/rules/events/l0/I50";
import { ctxOf, rawRow, ruleHarness } from "../helpers/rule-harness";
import { VALID_TERFIN } from "../helpers/fixtures";

const h = ruleHarness(I50);

describe("I50_ValidateFileLayout / 130", () => {
  it("fires once when any row has cells beyond the header width", () => {
    const rows = [rawRow(VALID_TERFIN, 2), rawRow(VALID_TERFIN, 3, ["EXTRA"]), rawRow(VALID_TERFIN, 4, ["a", "b"])];
    h.given(null, ctxOf({ rows })).expectFinding({
      messageId: "130",
      dataImportMessage: "The imported file contains data that is not associated with a valid column header.",
      portalMessage: "The imported file contains data that is not associated with a valid column header.",
      calculated: { firstOffendingLine: 3, offendingRows: 2 },
    });
    h.given(null, ctxOf({ rows })).expectCount(1);
  });
  it("does not fire when every row fits the header", () => {
    h.given(null, ctxOf({ rows: [rawRow(VALID_TERFIN, 2)] })).expectNoFinding();
  });
});
