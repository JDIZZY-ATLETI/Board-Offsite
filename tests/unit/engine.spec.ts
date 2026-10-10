import { describe, expect, it } from "vitest";
import { evaluateRecords, outcomeOf, runFileRules, runRecordRules } from "@/lib/rules/engine";
import { L1_RULES, L2_RULES, ruleById, rulesForLevel } from "@/lib/rules/registry";
import type { Rule } from "@/lib/rules/types";
import { cyBlock, stdMember } from "../helpers/ariel-fixtures";
import { ctxOf, rec } from "../helpers/rule-harness";

const deps = { newId: () => "id", now: () => new Date("2026-10-08T12:00:00.000Z") };

describe("rules engine", () => {
  it("registry lookups", () => {
    expect(ruleById("I51")?.level).toBe("L0");
    expect(ruleById("nope")).toBeUndefined();
    expect(rulesForLevel("L0").map((r) => r.id)).toEqual(["I50", "I51"]);
    expect(rulesForLevel("L1")).toBe(L1_RULES);
    expect(rulesForLevel("L2")).toBe(L2_RULES);
    expect(rulesForLevel("L2")[0].id).toBe("B2");
    expect(rulesForLevel("L2")).toHaveLength(41);
  });

  it("evaluates a clean record to ACCEPTED and a CME record to REJECTED, all rules reported at once", () => {
    const good = rec(cyBlock("2026-09-30", 38, 78000), 2);
    const bad = rec({ SIN: "900000027", Weeks_CurrentYear: "-1.234", EventType: "FOO" }, 3);
    const ctx = ctxOf({ records: [good, bad], ariel: [stdMember()] });
    const r = evaluateRecords(ctx, deps);
    expect(r.outcomes.get(good.recordId)).toBe("ACCEPTED");
    expect(r.recordFindings.get(good.recordId)).toEqual([]);
    // Unknown SIN with an Ariel-free snapshot: B2 fires and every Ariel-reading L2 rule is skipped (section 7.3).
    const unknown = rec({ SIN: "900000035" }, 4);
    const r2 = evaluateRecords(ctxOf({ records: [unknown] }), deps);
    expect(r2.recordFindings.get(unknown.recordId)?.map((f) => f.ruleId)).toEqual(["B2"]);
    expect(r2.timings.some((t) => t.ruleId === "B5")).toBe(false);
    // A WARNING without an override holds the row; INFORMATION never blocks.
    const warn = { ...r.recordFindings.get(bad.recordId)![0], severity: "WARNING" as const };
    expect(outcomeOf([warn])).toBe("HELD");
    expect(outcomeOf([{ ...warn, override: { reason: "x", actor: "a", at: "t" } }])).toBe("ACCEPTED");
    expect(outcomeOf([{ ...warn, severity: "INFORMATION" }])).toBe("ACCEPTED");
    expect(r.outcomes.get(bad.recordId)).toBe("REJECTED");
    expect(r.recordFindings.get(bad.recordId)?.map((f) => f.messageId).sort()).toEqual(["6503", "8034", "9099", "9519"]);
    expect(r.timings.find((t) => t.ruleId === "I1")?.evaluations).toBe(2);
    expect(outcomeOf([])).toBe("ACCEPTED");
  });

  it("I2 suppresses SIN-keyed rules (I10, L2) for the row", () => {
    const a = rec({ SIN: "", EmploymentEndDate: "01012030" }, 2);
    const ctx = ctxOf({ records: [a] });
    const ids = runRecordRules(a, ctx, deps).map((f) => f.ruleId);
    expect(ids).toContain("I2");
    expect(ids).not.toContain("I42");
  });

  it("respects RULES_DISABLED", () => {
    const a = rec({ EventType: "FOO" }, 2);
    expect(runRecordRules(a, ctxOf({ records: [a], disabled: ["I9"] }), deps).map((f) => f.ruleId)).not.toContain("I9");
    expect(runFileRules(ctxOf({ header: [], disabled: ["I51"] }), deps).findings).toHaveLength(0);
  });

  it("a throwing rule becomes a PRIVATE SYS-RULE-ERROR finding instead of sinking the batch", () => {
    const boom: Rule = { ...L1_RULES[0], id: "BOOM", evaluate: () => { throw new Error("kaboom"); } };
    const original = L1_RULES.splice(0, L1_RULES.length, boom);
    try {
      const a = rec({}, 2);
      const out = runRecordRules(a, ctxOf({ records: [a] }), deps);
      expect(out.map((f) => f.ruleId)).toEqual(["SYS-RULE-ERROR"]);
      expect(out[0]).toMatchObject({ visibility: "PRIVATE", severity: "COMPLETE_MEMBER_ERROR", params: { rule: "BOOM", error: "kaboom" } });
      expect(out[0].dataImportMessage).toBe("Rule BOOM failed: kaboom");
    } finally {
      L1_RULES.splice(0, L1_RULES.length, ...original);
    }
  });
});
