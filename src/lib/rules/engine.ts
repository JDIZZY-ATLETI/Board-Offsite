import type { EventsRecord, FindingSeverity, RecordOutcome, RuleTiming, ValidationFinding } from "@/types";
import { ruleEnabled } from "./config";
import { L0_RULES, L1_RULES, L2_RULES } from "./registry";
import { renderMessage } from "./render";
import type { FindingDraft, Rule, RuleContext, RuleSkip } from "./types";

export interface EngineDeps {
  newId: () => string;
  now: () => Date;
  /** Receives the full exception of a rule that threw; the persisted finding only carries a reference (SEC-INFO). */
  onRuleError?: (info: { ruleId: string; lineNumber: number | null; ref: string; error: unknown }) => void;
}

export interface EvaluationResult {
  fileFindings: ValidationFinding[];
  /** Findings per record id, each list in deterministic order. */
  recordFindings: Map<string, ValidationFinding[]>;
  outcomes: Map<string, RecordOutcome>;
  timings: RuleTiming[];
  /** Rules that declined to evaluate a record (reason is machine-readable, e.g. RATE_MISSING:MGA:2027). */
  skips: RuleSkip[];
}

export function buildFinding(
  rule: Rule,
  draft: FindingDraft,
  record: EventsRecord | null,
  batchId: string,
  deps: EngineDeps,
  sortOrder: number,
): ValidationFinding {
  const messageId = draft.messageIdOverride ?? (typeof rule.messageId === "function" ? rule.messageId(draft) : rule.messageId);
  return {
    findingId: deps.newId(),
    batchId,
    recordId: record?.recordId ?? null,
    lineNumber: record?.lineNumber ?? null,
    sinPseudo: record?.sinPseudo ?? null,
    ruleId: rule.id,
    messageId,
    level: rule.level,
    severity: rule.severity,
    visibility: rule.visibility,
    field: draft.field ?? null,
    yearScope: draft.yearScope ?? null,
    params: draft.params,
    dataImportMessage: renderMessage(rule.dataImportMessage, draft.params),
    portalMessage: renderMessage(rule.portalMessage, draft.params),
    overrideReasons: [...rule.overrideReasons],
    calculated: draft.calculated,
    createdAt: deps.now().toISOString(),
    sortOrder,
  };
}

function isEnabled(rule: Rule, ctx: RuleContext): boolean {
  return ruleEnabled(ctx.config, rule.id, rule.enabledByDefault);
}

const BLOCKING: FindingSeverity[] = ["FILE_ERROR", "COMPLETE_MEMBER_ERROR"];

/**
 * Architecture section 7.3: CME -> REJECTED; any WARNING without an override -> HELD; INFORMATION never
 * affects the outcome.
 */
export function outcomeOf(findings: ValidationFinding[]): RecordOutcome {
  if (findings.some((f) => BLOCKING.includes(f.severity))) return "REJECTED";
  if (findings.some((f) => f.severity === "WARNING" && !f.override)) return "HELD";
  return "ACCEPTED";
}

class Timer {
  private readonly map = new Map<string, RuleTiming>();
  readonly skips: RuleSkip[] = [];
  record(rule: Rule, ms: number, findings: number) {
    const t = this.map.get(rule.id) ?? { ruleId: rule.id, level: rule.level, evaluations: 0, findings: 0, durationMs: 0 };
    t.evaluations += 1;
    t.findings += findings;
    t.durationMs += ms;
    this.map.set(rule.id, t);
  }
  skip(ruleId: string, record: EventsRecord, reason: string) {
    this.skips.push({ ruleId, recordId: record.recordId, lineNumber: record.lineNumber, reason });
  }
  list(): RuleTiming[] {
    const skipped = new Map<string, number>();
    for (const s of this.skips) skipped.set(s.ruleId, (skipped.get(s.ruleId) ?? 0) + 1);
    return [...this.map.values()].map((t) => ({ ...t, durationMs: Math.round(t.durationMs * 1000) / 1000, ...(skipped.has(t.ruleId) ? { skipped: skipped.get(t.ruleId) } : {}) }));
  }
}

/** The rule context with the engine's diagnostics sink attached (skips are counted per rule and listed per record). */
function withSink(ctx: RuleContext, timer: Timer): RuleContext {
  return { ...ctx, skip: (ruleId, record, reason) => timer.skip(ruleId, record, reason) };
}

/** Runs L0 rules once over the whole file. Any finding rejects the file. */
export function runFileRules(ctx: RuleContext, deps: EngineDeps, timer = new Timer()): { findings: ValidationFinding[]; timings: RuleTiming[] } {
  const findings: ValidationFinding[] = [];
  for (const rule of L0_RULES) {
    if (!isEnabled(rule, ctx) || !rule.appliesTo(null, ctx)) continue;
    const t0 = performance.now();
    const drafts = rule.evaluate(null, ctx);
    timer.record(rule, performance.now() - t0, drafts.length);
    drafts.forEach((d, i) => findings.push(buildFinding(rule, d, null, ctx.batch.batchId, deps, i)));
  }
  return { findings, timings: timer.list() };
}

/**
 * Runs L1 then L2 rules for one record. All rules in a level run so the employer sees every problem; L2 is
 * skipped once L1 rejected the row, and the Ariel-reading L2 rules are skipped once B2 fired (section 7.3).
 */
export function runRecordRules(record: EventsRecord, baseCtx: RuleContext, deps: EngineDeps, timer = new Timer()): ValidationFinding[] {
  const ctx = withSink(baseCtx, timer);
  const out: ValidationFinding[] = [];
  let sinBlank = false;
  let memberUnknown = false;
  for (const level of [L1_RULES, L2_RULES]) {
    if (level === L2_RULES && out.some((f) => BLOCKING.includes(f.severity))) break;
    for (const rule of level) {
      if (!isEnabled(rule, ctx)) continue;
      // I2 suppresses SIN-keyed rules for the row (architecture section 7.3 exception a).
      if (sinBlank && (rule.id === "I10" || rule.level === "L2")) continue;
      if (memberUnknown && rule.requiresAriel) continue;
      if (!rule.appliesTo(record, ctx)) continue;
      const t0 = performance.now();
      let drafts: FindingDraft[];
      try {
        drafts = rule.evaluate(record, ctx);
      } catch (err) {
        // Architecture section 10.5: one bad rule must not sink the batch.
        timer.record(rule, performance.now() - t0, 1);
        out.push(systemRuleError(rule, err, record, ctx, deps));
        continue;
      }
      // Skips are recorded via ctx.skip; a skipped evaluation still counts as evaluated with 0 findings.
      timer.record(rule, performance.now() - t0, drafts.length);
      if (rule.id === "I2" && drafts.length > 0) sinBlank = true;
      if (rule.id === "B2" && drafts.length > 0) memberUnknown = true;
      drafts.forEach((d, i) => out.push(buildFinding(rule, d, record, ctx.batch.batchId, deps, i)));
    }
  }
  return out;
}

const SYS_RULE_ERROR: Rule = {
  id: "SYS-RULE-ERROR",
  label: "SYS-RULE-ERROR",
  messageId: "SYS-RULE-ERROR",
  level: "L1",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PRIVATE",
  section: ["EVENTS"],
  tool: "DataImport",
  overrideReasons: [],
  dataImportMessage: "Rule {rule} failed: {error}",
  portalMessage: "A validation rule could not be evaluated for this record. HOOPP has been notified.",
  enabledByDefault: true,
  requiresAriel: false,
  appliesTo: () => false,
  evaluate: () => [],
};

/**
 * The exception text never reaches the persisted finding (it could quote cell values or SQL - Phase 2 QA SEC
 * INFO, same posture as `sanitizeFailureReason`); the full error goes to `deps.onRuleError` with a deterministic
 * reference that is also written into the finding so support can correlate the two.
 */
function systemRuleError(rule: Rule, err: unknown, record: EventsRecord, ctx: RuleContext, deps: EngineDeps): ValidationFinding {
  const ref = `${ctx.batch.batchId.slice(-12)}-${rule.id}-L${record.lineNumber}`;
  deps.onRuleError?.({ ruleId: rule.id, lineNumber: record.lineNumber, ref, error: err });
  const message = `Rule evaluation failed. Reference ${ref} - details are in the server log.`;
  return buildFinding(SYS_RULE_ERROR, { params: { rule: rule.id, error: message }, calculated: { errorRef: ref, errorType: err instanceof Error ? err.name : typeof err } }, record, ctx.batch.batchId, deps, 0);
}

export function evaluateRecords(ctx: RuleContext, deps: EngineDeps): EvaluationResult {
  const timer = new Timer();
  const recordFindings = new Map<string, ValidationFinding[]>();
  const outcomes = new Map<string, RecordOutcome>();
  for (const record of ctx.file.records) {
    const findings = runRecordRules(record, ctx, deps, timer);
    recordFindings.set(record.recordId, findings);
    outcomes.set(record.recordId, outcomeOf(findings));
  }
  return { fileFindings: [], recordFindings, outcomes, timings: timer.list(), skips: timer.skips };
}

export function buildSinCounts(records: EventsRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of records) if (r.sin) m.set(r.sin, (m.get(r.sin) ?? 0) + 1);
  return m;
}

/** Findings as persisted to silver/findings.ndjson: no ids or timestamps, so two runs are byte-identical (AC2). */
export function lakeFinding(f: ValidationFinding): Record<string, unknown> {
  const { findingId: _id, recordId: _rid, batchId: _bid, createdAt: _at, ...rest } = f;
  void _id;
  void _rid;
  void _bid;
  void _at;
  return rest;
}
