import type { ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import { deriveProvisional, type FileDerived } from "@/lib/derivation/provisional";
import type { ParsedEventsFile } from "@/lib/events/parse";
import type { RulesConfig } from "@/lib/rules/config";
import { buildSinCounts, evaluateRecords, type EngineDeps, type EvaluationResult } from "@/lib/rules/engine";
import type { RuleContext } from "@/lib/rules/types";
import type { ArielRateTables, EventsRecord, IsoDate, RecordOutcome, ValidationFinding } from "@/types";

export interface ValidationInputs {
  batch: { batchId: string; employerId: string; executionDate: IsoDate };
  parsed: Pick<ParsedEventsFile, "rows" | "encodingProblem"> & { header: { observed: string[] } };
  records: EventsRecord[];
  snapshot: ArielBatchSnapshot;
  rates: ArielRateTables;
  config: RulesConfig;
}

/** The deterministic engine input (architecture section 7.6): bronze records + Ariel snapshot + config + execution date. */
export function buildRuleContext(i: ValidationInputs): RuleContext {
  const cache = new Map<string, FileDerived | null>();
  return {
    batch: i.batch,
    file: { header: i.parsed.header.observed, rows: i.parsed.rows, records: i.records, encodingProblem: i.parsed.encodingProblem },
    config: i.config,
    now: () => i.batch.executionDate,
    sinCounts: buildSinCounts(i.records),
    ariel: i.snapshot,
    rates: i.rates,
    derived: (record) => {
      if (!cache.has(record.recordId)) cache.set(record.recordId, deriveProvisional(record, i.snapshot, i.batch.employerId, i.batch.executionDate));
      return cache.get(record.recordId)!;
    },
  };
}

export interface ValidationOutput extends EvaluationResult {
  /** Every record finding in file order with the record-local sortOrder applied. */
  findings: ValidationFinding[];
  accepted: EventsRecord[];
  rejected: EventsRecord[];
  held: EventsRecord[];
}

export function runValidation(i: ValidationInputs, deps: EngineDeps): ValidationOutput {
  const ctx = buildRuleContext(i);
  const evaluation = evaluateRecords(ctx, deps);
  const findings: ValidationFinding[] = [];
  for (const r of i.records) {
    const list = evaluation.recordFindings.get(r.recordId) ?? [];
    list.forEach((f, idx) => findings.push({ ...f, sortOrder: idx }));
  }
  const by = (o: RecordOutcome) => i.records.filter((r) => evaluation.outcomes.get(r.recordId) === o);
  return { ...evaluation, findings, accepted: by("ACCEPTED"), rejected: by("REJECTED"), held: by("HELD") };
}

/** Persisted copy of the effective config (silver/rules-config.json) so offline re-validation uses the same parameters. */
export function serializeRulesConfig(c: RulesConfig): string {
  return JSON.stringify({ hash: c.hash, i42ApplyToRetfin: c.i42ApplyToRetfin, disabled: [...c.disabled].sort(), enabled: c.enabled, tolerances: c.tolerances, nhh: c.nhh, nhhEmployers: c.nhhEmployers }, null, 2);
}

export function deserializeRulesConfig(text: string): RulesConfig {
  const o = JSON.parse(text) as { hash: string; i42ApplyToRetfin: boolean; disabled: string[]; enabled: Record<string, boolean>; tolerances: Record<string, number | string>; nhh: Record<string, IsoDate>; nhhEmployers: string[] };
  return { hash: o.hash, i42ApplyToRetfin: o.i42ApplyToRetfin, disabled: new Set(o.disabled), enabled: o.enabled, tolerances: o.tolerances, nhh: o.nhh, nhhEmployers: o.nhhEmployers };
}