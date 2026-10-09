import { describe, it } from "vitest";
import { I51 } from "@/lib/rules/events/l0/I51";
import { EVENTS_CSV_COLUMNS } from "@/types";
import { ctxOf, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I51);
const H = [...EVENTS_CSV_COLUMNS];

describe("I51_ValidateFileHeaderLayout / 4887", () => {
  it("fires on an unknown header label", () => {
    const header = H.map((c) => (c === "LastName" ? "LastNme" : c));
    h.given(null, ctxOf({ header })).expectFinding({
      messageId: "4887",
      dataImportMessage: "The imported file contains invalid column headers.",
      portalMessage: "The imported file contains invalid column headers.",
      calculated: { reason: "INVALID_HEADER", invalidLabels: "LastNme" },
    });
  });
  it("fires on a duplicated label (legacy 6926 scenario)", () => {
    h.given(null, ctxOf({ header: [...H, "PA_CurrentYear"] })).expectFinding({ calculated: { reason: "DUPLICATE_HEADER" } });
  });
  it("fires on an empty file", () => {
    h.given(null, ctxOf({ header: [] })).expectFinding({ calculated: { reason: "EMPTY_FILE" } });
  });
  it("is case-sensitive", () => {
    h.given(null, ctxOf({ header: H.map((c) => (c === "SIN" ? "Sin" : c)) })).expectFinding({ calculated: { reason: "INVALID_HEADER" } });
  });
  it("accepts the exact layout, any column order, missing non-mandatory columns and the optional DateOfDeath", () => {
    h.given(null, ctxOf({ header: H })).expectNoFinding();
    h.given(null, ctxOf({ header: [...H].reverse() })).expectNoFinding();
    h.given(null, ctxOf({ header: H.filter((c) => c !== "PA_PreviousYear") })).expectNoFinding();
    h.given(null, ctxOf({ header: [...H, "DateOfDeath"] })).expectNoFinding();
  });
});
