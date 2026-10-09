import { expect } from "vitest";
import { buildRecord } from "@/lib/events/record";
import { buildFinding, buildSinCounts, type EngineDeps } from "@/lib/rules/engine";
import { hasUnresolvedPlaceholders } from "@/lib/rules/render";
import type { Rule, RuleContext } from "@/lib/rules/types";
import { EVENTS_CSV_COLUMNS, type EventsRecord, type IsoDate, type RawEventsRow, type RawValues, type ValidationFinding, type YearScope } from "@/types";
import { VALID_TERFIN } from "./fixtures";

const KEY = Buffer.from("a1".repeat(32), "hex");

export function rawRow(values: Partial<RawValues>, lineNumber = 2, extraValues: string[] = []): RawEventsRow {
  const v = {} as RawValues;
  for (const c of EVENTS_CSV_COLUMNS) v[c] = null;
  for (const [k, val] of Object.entries(values)) (v as Record<string, string | null>)[k] = val === "" ? null : (val as string | null);
  return { lineNumber, values: v, extraValues };
}

/** A valid TERFIN record with overrides applied to the raw cells. */
export function rec(over: Partial<RawValues> = {}, lineNumber = 2): EventsRecord {
  let n = 0;
  return buildRecord(rawRow({ ...VALID_TERFIN, ...over }, lineNumber), { batchId: "00000000-0000-7000-8000-000000000000", pseudonymKey: KEY, newId: () => `rec-${++n}` });
}

export interface CtxOptions {
  executionDate?: IsoDate;
  header?: string[];
  rows?: RawEventsRow[];
  records?: EventsRecord[];
  i42ApplyToRetfin?: boolean;
  disabled?: string[];
}

export function ctxOf(o: CtxOptions = {}): RuleContext {
  const records = o.records ?? [];
  return {
    batch: { batchId: "00000000-0000-7000-8000-000000000000", employerId: "0235", executionDate: o.executionDate ?? "2026-10-08" },
    file: { header: o.header ?? [...EVENTS_CSV_COLUMNS], rows: o.rows ?? [], records },
    config: { i42ApplyToRetfin: o.i42ApplyToRetfin ?? true, disabled: new Set(o.disabled ?? []) },
    now: () => o.executionDate ?? "2026-10-08",
    sinCounts: buildSinCounts(records),
  };
}

const deps: EngineDeps = { newId: () => "finding", now: () => new Date("2026-10-08T12:00:00.000Z") };

export interface Expectation {
  messageId?: string;
  field?: string;
  yearScope?: YearScope;
  params?: Record<string, string | number>;
  dataImportMessage?: string;
  portalMessage?: string;
  calculated?: Record<string, string | number | boolean>;
}

export function evaluateRule(rule: Rule, record: EventsRecord | null, ctx: RuleContext): ValidationFinding[] {
  if (!rule.appliesTo(record, ctx)) return [];
  return rule.evaluate(record, ctx).map((d, i) => buildFinding(rule, d, record, ctx.batch.batchId, deps, i));
}

export function ruleHarness(rule: Rule) {
  return {
    given(record: EventsRecord | null, ctx: RuleContext = ctxOf({ records: record ? [record] : [] })) {
      const findings = evaluateRule(rule, record, ctx);
      return {
        findings,
        expectNoFinding() {
          expect(findings, `${rule.id} should not fire`).toHaveLength(0);
        },
        expectFinding(e: Expectation = {}) {
          expect(findings.length, `${rule.id} should fire`).toBeGreaterThan(0);
          const f = findings.find((x) => (e.field ? x.field === e.field : true) && (e.yearScope ? x.yearScope === e.yearScope : true));
          expect(f, `${rule.id} finding for ${e.field ?? "any"}/${e.yearScope ?? "any"}`).toBeDefined();
          const found = f as ValidationFinding;
          if (e.messageId) expect(found.messageId).toBe(e.messageId);
          if (e.params) expect(found.params).toEqual(e.params);
          if (e.dataImportMessage) expect(found.dataImportMessage).toBe(e.dataImportMessage);
          if (e.portalMessage) expect(found.portalMessage).toBe(e.portalMessage);
          if (e.calculated) expect(found.calculated).toMatchObject(e.calculated);
          expect(hasUnresolvedPlaceholders(found.dataImportMessage), `unresolved placeholder in ${found.dataImportMessage}`).toBe(false);
          expect(hasUnresolvedPlaceholders(found.portalMessage), `unresolved placeholder in ${found.portalMessage}`).toBe(false);
          expect(found.level).toBe(rule.level);
          expect(found.severity).toBe(rule.severity);
          expect(found.visibility).toBe(rule.visibility);
          return found;
        },
        expectCount(n: number) {
          expect(findings).toHaveLength(n);
        },
      };
    },
  };
}
