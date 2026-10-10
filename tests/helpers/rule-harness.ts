import { expect } from "vitest";
import { InMemoryArielSnapshot, type ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import { deriveProvisional } from "@/lib/derivation/provisional";
import type { EncodingProblem } from "@/lib/events/decode";
import { buildRecord } from "@/lib/events/record";
import { buildRulesConfig, readRulesConfigFile, type RulesConfigOverride } from "@/lib/rules/config";
import { buildFinding, buildSinCounts, type EngineDeps } from "@/lib/rules/engine";
import { hasUnresolvedPlaceholders } from "@/lib/rules/render";
import type { Rule, RuleContext } from "@/lib/rules/types";
import { EVENTS_CSV_COLUMNS, type ArielMemberSnapshot, type ArielRateTables, type EventsRecord, type IsoDate, type RawEventsRow, type RawValues, type ValidationFinding, type YearScope } from "@/types";
import { cyBlock, RATES, snapshotOf, stdMember } from "./ariel-fixtures";
import { VALID_TERFIN } from "./fixtures";

const KEY = Buffer.from("a1".repeat(32), "hex");
const FILE_CONFIG = readRulesConfigFile();

export function rawRow(values: Partial<RawValues>, lineNumber = 2, extraValues: string[] = []): RawEventsRow {
  const v = {} as RawValues;
  for (const c of EVENTS_CSV_COLUMNS) v[c] = null;
  for (const [k, val] of Object.entries(values)) (v as Record<string, string | null>)[k] = val === "" ? null : (val as string | null);
  return { lineNumber, values: v, extraValues };
}

let recCounter = 0;

/** A valid TERFIN record with overrides applied to the raw cells. */
export function rec(over: Partial<RawValues> = {}, lineNumber = 2): EventsRecord {
  return buildRecord(rawRow({ ...VALID_TERFIN, ...over }, lineNumber), { batchId: "00000000-0000-7000-8000-000000000000", pseudonymKey: KEY, newId: () => `rec-${++recCounter}` });
}

export interface CtxOptions {
  executionDate?: IsoDate;
  employerId?: string;
  header?: string[];
  rows?: RawEventsRow[];
  records?: EventsRecord[];
  encodingProblem?: EncodingProblem | null;
  i42ApplyToRetfin?: boolean;
  disabled?: string[];
  /** Ariel members visible to the rules (fixture snapshot). */
  ariel?: ArielMemberSnapshot[] | ArielBatchSnapshot;
  rates?: ArielRateTables;
  /** Config overrides (enable flags / tolerances) layered on config/rules.events.json. */
  overrides?: RulesConfigOverride[];
}

export function ctxOf(o: CtxOptions = {}): RuleContext {
  const records = o.records ?? [];
  const employerId = o.employerId ?? "0235";
  const executionDate = o.executionDate ?? "2026-10-08";
  const ariel = Array.isArray(o.ariel) ? snapshotOf(o.ariel, "00000000-0000-7000-8000-000000000000", employerId) : (o.ariel ?? InMemoryArielSnapshot.empty("00000000-0000-7000-8000-000000000000", employerId, "FixtureAdapter"));
  const cache = new Map<string, ReturnType<typeof deriveProvisional>>();
  return {
    batch: { batchId: "00000000-0000-7000-8000-000000000000", employerId, executionDate },
    file: { header: o.header ?? [...EVENTS_CSV_COLUMNS], rows: o.rows ?? [], records, encodingProblem: o.encodingProblem ?? null },
    config: buildRulesConfig({ file: FILE_CONFIG, overrides: o.overrides, i42ApplyToRetfin: o.i42ApplyToRetfin ?? true, disabled: o.disabled ?? [] }),
    now: () => executionDate,
    sinCounts: buildSinCounts(records),
    ariel,
    rates: o.rates ?? RATES,
    derived: (record) => {
      if (!cache.has(record.recordId)) cache.set(record.recordId, deriveProvisional(record, ariel, employerId, executionDate));
      return cache.get(record.recordId)!;
    },
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
/** Clean TERFIN baseline (2026-09-30, 38 weeks, AE 78,000) that produces zero L2 findings against `stdMember()`. */
export const CLEAN_CY: Partial<RawValues> = cyBlock("2026-09-30", 38, 78000);

/**
 * L2 harness: `given(fileOverrides, members?, ctxOptions?)` builds one record from the clean baseline and a
 * snapshot from the given members (default: the matching `stdMember()`), so each spec perturbs one thing.
 */
export function l2Harness(rule: Rule) {
  const h = ruleHarness(rule);
  return {
    raw: h,
    given(over: Partial<RawValues> = {}, members: ArielMemberSnapshot[] | null = null, opts: Omit<CtxOptions, "records" | "ariel"> = {}) {
      const r = rec({ ...CLEAN_CY, ...over });
      return h.given(r, ctxOf({ ...opts, records: [r], ariel: members ?? [stdMember()] }));
    },
  };
}
