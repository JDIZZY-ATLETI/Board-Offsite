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
    expect(L2_RULES.map((r) => r.id)).toEqual([
      "B2", "B204", "B224", "B5", "B223", "B109", "I42", "B112", "B113", "B139", "B192a", "B192b", "B22", "B19", "B19b", "B31", "B33", "B37", "B38",
      "B184a", "B184b", "B184c", "B185", "B186a", "B186b", "B186c", "B53a", "B53b", "B181", "B182", "B40", "B41", "B43", "B44", "B47", "B214",
      "B207", "B203", "B205", "B206", "B202",
    ]);
    expect(L2_RULES).toHaveLength(41);
  });
  it("has a spec file for every registered rule", () => {
    for (const r of EVENTS_RULES) {
      expect(existsSync(path.resolve(__dirname, `${r.id}.spec.ts`)), `missing tests/rules/${r.id}.spec.ts`).toBe(true);
    }
  });
  it("renders every template without leftover placeholders given representative params", () => {
    const sample: Record<string, string | number> = { 0: "v", 1: "v", 2: "v", 3: "v", "File.FieldName": "Weeks_CurrentYear", "Max Length": 5, 4: "v", "1/2": "Termination" };
    for (const r of EVENTS_RULES) {
      expect(hasUnresolvedPlaceholders(renderMessage(r.dataImportMessage, sample)), r.id).toBe(false);
      expect(hasUnresolvedPlaceholders(renderMessage(r.portalMessage, sample)), r.id).toBe(false);
    }
  });
  it("L0/L1 rules and I42 are Ariel-free and PUBLIC; every other L2 rule reads the Ariel snapshot", () => {
    for (const r of [...L0_RULES, ...L1_RULES, ...L2_RULES.filter((x) => x.id === "I42")]) {
      expect(r.requiresAriel, r.id).toBe(false);
      expect(r.visibility, r.id).toBe("PUBLIC");
    }
    for (const r of L2_RULES.filter((x) => x.id !== "I42")) expect(r.requiresAriel, r.id).toBe(true);
  });
  it("Phase 2 defaults (architecture section 18): B181 disabled, B153 excluded, B31 is a WARNING with an override reason, PRIVATE rules are INFORMATION", () => {
    expect(EVENTS_RULES.find((r) => r.id === "B181")?.enabledByDefault).toBe(false);
    expect(EVENTS_RULES.some((r) => r.id === "B153")).toBe(false);
    const b31 = EVENTS_RULES.find((r) => r.id === "B31")!;
    expect(b31.severity).toBe("WARNING");
    expect(b31.overrideReasons).toHaveLength(1);
    for (const r of EVENTS_RULES.filter((x) => x.visibility === "PRIVATE")) expect(r.severity, r.id).toBe("INFORMATION");
    expect(EVENTS_RULES.filter((x) => x.visibility === "PRIVATE").map((r) => r.id)).toEqual(["B182", "B41", "B44"]);
    for (const r of EVENTS_RULES.filter((x) => x.severity === "WARNING")) expect(r.overrideReasons.length, r.id).toBeGreaterThan(0);
    expect(EVENTS_RULES.filter((x) => x.severity === "WARNING").map((r) => r.id)).toEqual(["B139", "B31", "B33", "B38", "B40", "B43", "B47", "B214"]);
  });
});
