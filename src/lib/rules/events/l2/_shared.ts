import type { FileDerived } from "@/lib/derivation/provisional";
import type { EventsRecord } from "@/types";
import { defineRule, type Rule, type RuleContext, type RuleSpec } from "../../types";

export type L2Evaluate = (record: EventsRecord, d: FileDerived, ctx: RuleContext) => ReturnType<Rule["evaluate"]>;

/**
 * L2 business rule needing the matched employment: level/requiresAriel are fixed and `evaluate` only runs when
 * the provisional derivation exists (B2 has already rejected the row otherwise).
 */
export function l2Rule(spec: Omit<RuleSpec, "level" | "requiresAriel" | "evaluate" | "appliesTo"> & { appliesTo?: (record: EventsRecord, d: FileDerived, ctx: RuleContext) => boolean; evaluate: L2Evaluate }): Rule {
  const { appliesTo, evaluate, ...rest } = spec;
  return defineRule({
    ...rest,
    level: "L2",
    requiresAriel: true,
    appliesTo(record, ctx) {
      if (!record || !record.sinPseudo) return false;
      const d = ctx.derived(record);
      if (!d) return false;
      return appliesTo ? appliesTo(record, d, ctx) : true;
    },
    evaluate(record, ctx) {
      if (!record) return [];
      const d = ctx.derived(record);
      if (!d) return [];
      return evaluate(record, d, ctx);
    },
  });
}