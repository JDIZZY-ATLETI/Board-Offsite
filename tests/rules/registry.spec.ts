import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertRegistryConsistent, EVENTS_RULES, L0_RULES, L1_RULES, L2_RULES } from "@/lib/rules/registry";
import { hasUnresolvedPlaceholders, renderMessage } from "@/lib/rules/render";

describe("rules registry", () => {
  it("is consistent and in the architecture section 7.9.4 order", () => {
    expect(() => assertRegistryConsistent()).not.toThrow();
    expect(L0_RULES.map((r) => r.id)).toEqual(["I50", "I51"]);
    expect(L1_RULES.map((r) => r.id)).toEqual([
      "I2", "I1", "I9", "I5", "I8", "I7", "I3",
      "B187_WeeksCurrentYear", "B187_LowContributionsCurrentYear", "B187_HighContributionsCurrentYear",
      "B187_WeeksPreviousYear", "B187_LCPreviousYear", "B187_HCPreviousYear",
      "I10", "I32", "I55",
    ]);
    expect(L2_RULES.map((r) => r.id)).toEqual(["I42"]);
  });
  it("has a spec file for every registered rule", () => {
    for (const r of EVENTS_RULES) {
      expect(existsSync(path.resolve(__dirname, `${r.id}.spec.ts`)), `missing tests/rules/${r.id}.spec.ts`).toBe(true);
    }
  });
  it("renders every template without leftover placeholders given representative params", () => {
    const sample: Record<string, string | number> = { 0: "v", 1: "v", 2: "v", 3: "v", "File.FieldName": "Weeks_CurrentYear", "Max Length": 5 };
    for (const r of EVENTS_RULES) {
      expect(hasUnresolvedPlaceholders(renderMessage(r.dataImportMessage, sample)), r.id).toBe(false);
      expect(hasUnresolvedPlaceholders(renderMessage(r.portalMessage, sample)), r.id).toBe(false);
    }
  });
  it("all Phase 1 rules are Ariel-free and PUBLIC", () => {
    for (const r of EVENTS_RULES) {
      expect(r.requiresAriel).toBe(false);
      expect(r.visibility).toBe("PUBLIC");
    }
  });
});
