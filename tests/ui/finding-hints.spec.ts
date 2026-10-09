import { describe, expect, it } from "vitest";
import { FINDING_HINTS, hintFor, hintKeyFor } from "@/components/app/findings/finding-hints";
import { EVENTS_RULES } from "@/lib/rules/registry";
import type { ValidationFinding } from "@/types";

function finding(partial: Partial<ValidationFinding> & Pick<ValidationFinding, "ruleId">): ValidationFinding {
  return {
    findingId: "f1",
    batchId: "b1",
    recordId: null,
    lineNumber: 12,
    sinPseudo: null,
    messageId: "0",
    level: "L1",
    severity: "COMPLETE_MEMBER_ERROR",
    visibility: "PUBLIC",
    field: null,
    yearScope: null,
    params: {},
    dataImportMessage: "",
    portalMessage: "Portal text",
    overrideReasons: [],
    createdAt: "2026-10-08T00:00:00.000Z",
    sortOrder: 0,
    ...partial,
  };
}

describe("finding-hints (section 7.2, D2)", () => {
  it("every implemented Phase 1 rule has a hint", () => {
    for (const r of EVENTS_RULES.filter((x) => !x.requiresAriel)) {
      expect(hintKeyFor(r.id), r.id).not.toBeNull();
    }
  });

  it("B187_* variants resolve to the B187 base hint", () => {
    expect(hintKeyFor("B187_WeeksCurrentYear")).toBe("B187");
    expect(hintKeyFor("B187_LCPreviousYear")).toBe("B187");
  });

  it("I5 fills the raw value and the field", () => {
    const h = hintFor(finding({ ruleId: "I5", field: "EmploymentEndDate", params: { 1: "20260930" } }));
    expect(h).toContain("MMDDYYYY");
    expect(h).toContain("`20260930`");
  });

  it("I10 fills the occurrence count from calculated", () => {
    expect(hintFor(finding({ ruleId: "I10", field: "SIN", calculated: { occurrences: 3, masked: true } }))).toContain("3 rows");
  });

  it("I51 lists unknown headers", () => {
    const h = hintFor(finding({ ruleId: "I51", severity: "FILE_ERROR", level: "L0", calculated: { reason: "INVALID_HEADER", invalidLabels: "Weeks_CurrYear|Foo" } }));
    expect(h).toContain("Weeks_CurrYear, Foo");
  });

  it("year scope maps to plain words", () => {
    expect(hintFor(finding({ ruleId: "I32", yearScope: "PREVIOUS" }))).toContain("the previous year");
    expect(hintFor(finding({ ruleId: "I55", yearScope: "CURRENT" }))).toContain("the current year");
  });

  it("returns null for rules without a hint so callers fall back to the Portal message", () => {
    expect(hintFor(finding({ ruleId: "ZZZ-UNKNOWN" }))).toBeNull();
  });

  it("warning rules share the reviewer-override wording", () => {
    expect(FINDING_HINTS.B40).toBe(FINDING_HINTS.B43);
    expect(FINDING_HINTS.B40).toContain("HOOPP reviewer");
  });
});