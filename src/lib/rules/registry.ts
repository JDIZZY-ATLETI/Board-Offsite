import type { Rule, RuleLevel } from "./types";
import { I50 } from "./events/l0/I50";
import { I51 } from "./events/l0/I51";
import { I1 } from "./events/l1/I1";
import { I2 } from "./events/l1/I2";
import { I3 } from "./events/l1/I3";
import { I5 } from "./events/l1/I5";
import { I7 } from "./events/l1/I7";
import { I8 } from "./events/l1/I8";
import { I9 } from "./events/l1/I9";
import { I10 } from "./events/l1/I10";
import { I32 } from "./events/l1/I32";
import { I55 } from "./events/l1/I55";
import { B187_RULES } from "./events/l1/B187";
import { L2_RULES } from "./events/l2";

/** Deterministic registry order (architecture section 7.9.4). */
export const L0_RULES: Rule[] = [I50, I51];
export const L1_RULES: Rule[] = [I2, I1, I9, I5, I8, I7, I3, ...B187_RULES, I10, I32, I55];
export { L2_RULES };

export const EVENTS_RULES: Rule[] = [...L0_RULES, ...L1_RULES, ...L2_RULES];

export function rulesForLevel(level: RuleLevel): Rule[] {
  return level === "L0" ? L0_RULES : level === "L1" ? L1_RULES : L2_RULES;
}

export function ruleById(id: string): Rule | undefined {
  return EVENTS_RULES.find((r) => r.id === id);
}

/** Startup assertion: ids unique, levels consistent with placement. */
export function assertRegistryConsistent(): void {
  const seen = new Set<string>();
  for (const r of EVENTS_RULES) {
    if (seen.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
    seen.add(r.id);
  }
  for (const r of L0_RULES) if (r.level !== "L0") throw new Error(`${r.id} registered as L0 but declares ${r.level}`);
  for (const r of L1_RULES) if (r.level !== "L1") throw new Error(`${r.id} registered as L1 but declares ${r.level}`);
  for (const r of L2_RULES) if (r.level !== "L2") throw new Error(`${r.id} registered as L2 but declares ${r.level}`);
}
