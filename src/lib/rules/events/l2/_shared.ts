import { missingRateTable, rateMissingReason } from "@/lib/ariel/rates";
import type { FileDerived } from "@/lib/derivation/provisional";
import type { EventsRecord } from "@/types";
import { defineRule, type Rule, type RuleContext, type RuleSpec } from "../../types";

export type L2Evaluate = (record: EventsRecord, d: FileDerived, ctx: RuleContext) => ReturnType<Rule["evaluate"]>;

/** Records why a rule produced nothing for the record (engine diagnostics / execution report) and returns no findings. */
export function skipRule(ctx: RuleContext, ruleId: string, record: EventsRecord, reason: string): [] {
  ctx.skip?.(ruleId, record, reason);
  return [];
}

/** `RATE_MISSING:<table>:<year>` for the first table without a value in `year`, or null when covered (BUG-L2-RATES-1). */
export function rateGap(ctx: RuleContext, year: number): string | null {
  const table = missingRateTable(ctx.rates, year);
  return table ? rateMissingReason(table, year) : null;
}

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