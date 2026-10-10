import { eq } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { InMemoryArielSnapshot, type ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import { canonicalize } from "@/lib/crypto/canonical";
import { sha256Hex } from "@/lib/crypto/hash";
import { batches, eventsRecords, rawFiles, validationFindings } from "@/lib/db/schema";
import { parseEventsCsv, type ParsedEventsFile } from "@/lib/events/parse";
import { buildRecord, maskedRawValues, recordParseOk } from "@/lib/events/record";
import { todayIso } from "@/lib/events/fields";
import { ingestDateOf, lakePaths, type LakePaths } from "@/lib/lake/paths";
import { batchStream, memberStream, systemActor } from "@/lib/ledger/streams";
import { encryptSin } from "@/lib/pii/sin";
import { loadEffectiveRulesConfig } from "@/lib/rules/config-store";
import type { RulesConfig } from "@/lib/rules/config";
import { lakeFinding, runFileRules, type EngineDeps } from "@/lib/rules/engine";
import type { BatchStatus, EventsRecord, ExecutionReport, FindingSummary, IsoDate, MemberRecordValidatedPayload, RuleTiming, ValidationFinding } from "@/types";
import { buildRejectedIndividualsCsv } from "./csv-out";
import { renderExecutionReportHtml } from "./execution-report";
import { transitionBatch } from "./state-machine";
import { buildSummaryOfValidationsCsv } from "./summary-report";
import { buildRuleContext, runValidation, serializeRulesConfig, type ValidationOutput } from "./validate";

const ACTOR = systemActor("pipeline");
const INSERT_CHUNK = 200;
const LEDGER_CHUNK = 500;

/** A pipeline failure whose message is safe to show users (no SQL, parameters or cell values). */
export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

/**
 * `failureReason` is visible to Submitters, so only `PipelineError` messages pass through; anything else
 * (driver errors carry the SQL statement and bind parameters) is replaced by a reference that is logged
 * together with the full error (QA BUG-PIPE-1 / SEC-INFO-1).
 */
export function sanitizeFailureReason(err: unknown, ref: string): string {
  const text = err instanceof PipelineError ? err.message : `Processing failed unexpectedly. Reference ${ref} - details are in the server log.`;
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 500);
}

type BatchRow = typeof batches.$inferSelect;
type RawFileRow = typeof rawFiles.$inferSelect;

interface RunState {
  batch: BatchRow;
  rawFile: RawFileRow;
  paths: LakePaths;
  startedAt: Date;
  outputs: string[];
  timings: RuleTiming[];
  ruleSkips: NonNullable<ExecutionReport["ruleSkips"]>;
  counts: ExecutionReport["counts"];
  lineCount: number;
  encoding: string;
  rulesConfigHash: string;
  arielAdapter: string;
  arielSnapshotHash: string;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function summarize(f: ValidationFinding): FindingSummary {
  return { ruleId: f.ruleId, messageId: f.messageId, field: f.field, yearScope: f.yearScope, params: f.params };
}

export function sortSummaries(list: FindingSummary[]): FindingSummary[] {
  return [...list].sort((a, b) => a.ruleId.localeCompare(b.ruleId) || (a.field ?? "").localeCompare(b.field ?? "") || (a.yearScope ?? "").localeCompare(b.yearScope ?? ""));
}

export function findingRow(f: ValidationFinding) {
  return {
    findingId: f.findingId,
    batchId: f.batchId,
    recordId: f.recordId,
    lineNumber: f.lineNumber,
    sinPseudo: f.sinPseudo,
    ruleId: f.ruleId,
    messageId: f.messageId,
    level: f.level,
    severity: f.severity,
    visibility: f.visibility,
    field: f.field,
    yearScope: f.yearScope,
    params: f.params,
    dataImportMessage: f.dataImportMessage,
    portalMessage: f.portalMessage,
    overrideReasons: f.overrideReasons,
    calculated: f.calculated ?? null,
    sortOrder: f.sortOrder,
    createdAt: f.createdAt,
  };
}

export function ndjson(items: unknown[]): string {
  return items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : "");
}

/** Public record shape for lake/API: raw SIN replaced by pseudonym + mask. */
export function publicRecord(r: EventsRecord) {
  const { sin: _sin, rawValues: _raw, ...rest } = r;
  void _sin;
  void _raw;
  return { ...rest, rawValues: maskedRawValues(r) };
}

export async function loadBatch(ctx: AppContext, batchId: string): Promise<{ batch: BatchRow; rawFile: RawFileRow } | null> {
  const [batch] = await ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  if (!batch) return null;
  const [rawFile] = await ctx.db.select().from(rawFiles).where(eq(rawFiles.rawFileId, batch.rawFileId));
  return { batch, rawFile };
}

/** Member outcome payload for accepted rows (architecture section 9 / Phase 2). */
export function validatedPayload(r: EventsRecord, findings: ValidationFinding[], rulesConfigHash: string, arielSnapshotHash: string): MemberRecordValidatedPayload {
  const summaries = sortSummaries(findings.map(summarize));
  return {
    recordId: r.recordId,
    lineNumber: r.lineNumber,
    sinMasked: r.sinMasked,
    eventType: r.eventType ?? null,
    eventDate: r.eventDate ?? null,
    findings: summaries,
    findingsHash: sha256Hex(canonicalize(summaries)),
    overrides: findings.filter((f) => f.override).map((f) => ({ findingId: f.findingId, ruleId: f.ruleId, reason: f.override!.reason })).sort((a, b) => a.findingId.localeCompare(b.findingId)),
    rulesConfigHash,
    arielSnapshotHash,
  };
}

export interface RunBatchOptions {
  /** Continue VALIDATED -> LEDGERED -> PROJECTION_BUILT -> PENDING_APPROVAL when no row is HELD (section 10.1). Default true. */
  advance?: boolean;
}

/**
 * Runs parse -> validate (L0/L1/L2 with Ariel snapshot) for a RECEIVED batch, then (unless `advance: false`)
 * the Phase 3 continuation when no row is HELD (architecture section 10.1 / 10.2).
 */
export async function runBatch(ctx: AppContext, batchId: string, opts: RunBatchOptions = {}): Promise<BatchStatus> {
  const status = await runValidationStage(ctx, batchId);
  const { projectLedger } = await import("@/lib/projection");
  await projectLedger(ctx).catch((err) => ctx.logger.error({ err, batchId }, "member projection update failed after validation"));
  if (status !== "VALIDATED" || opts.advance === false) return status;
  const { advanceBatch } = await import("./advance");
  return advanceBatch(ctx, batchId);
}

async function runValidationStage(ctx: AppContext, batchId: string): Promise<BatchStatus> {
  const loaded = await loadBatch(ctx, batchId);
  if (!loaded) throw new Error(`batch ${batchId} not found`);
  const { batch, rawFile } = loaded;
  const log = ctx.logger.child({ batchId, employerId: batch.employerId });
  if (batch.status !== "RECEIVED") {
    log.warn({ status: batch.status }, "runBatch called on a batch that is not RECEIVED; skipping");
    return batch.status;
  }
  const state: RunState = {
    batch,
    rawFile,
    paths: lakePaths({ employerId: batch.employerId, batchId, ingestDate: ingestDateOf(batch.receivedAt) }),
    startedAt: ctx.clock(),
    outputs: [rawFile.lakePath],
    timings: [],
    ruleSkips: [],
    counts: { linesRead: 0, rows: 0, accepted: 0, rejected: 0, held: 0, fileErrors: 0, memberErrors: 0, warnings: 0, infos: 0, findings: 0 },
    lineCount: 0,
    encoding: rawFile.encodingDetected,
    rulesConfigHash: "",
    arielAdapter: ctx.ariel.name,
    arielSnapshotHash: "",
  };
  const deps: EngineDeps = {
    newId: ctx.newId,
    now: ctx.clock,
    // The finding only carries `ref`; the exception text (which may quote cell values) stays in the log (SEC INFO).
    onRuleError: ({ ruleId, lineNumber, ref, error }) => log.error({ err: error, ruleId, lineNumber, ref }, "rule threw during evaluation"),
  };
  try {
    const config = await loadEffectiveRulesConfig(ctx);
    state.rulesConfigHash = config.hash;
    const bytes = await ctx.lake.get(rawFile.lakePath);
    const actualSha = sha256Hex(bytes);
    if (actualSha !== rawFile.sha256) throw new PipelineError(`raw file sha256 mismatch: manifest ${rawFile.sha256} vs lake ${actualSha}`);
    const parsed = parseEventsCsv(bytes);
    state.lineCount = parsed.lineCount;
    state.encoding = parsed.encoding;
    state.counts.linesRead = parsed.lineCount;
    state.counts.rows = parsed.rows.length;

    const records = parsed.rows.map((row) => buildRecord(row, { batchId, pseudonymKey: ctx.config.sinPseudonymKey, newId: ctx.newId }));
    const batchInfo = { batchId, employerId: batch.employerId, executionDate: batch.executionDate as IsoDate };

    // ---- L0 (needs no Ariel) ----
    const l0Ctx = buildRuleContext({ batch: batchInfo, parsed, records, snapshot: InMemoryArielSnapshot.empty(batchId, batch.employerId, ctx.ariel.name), rates: await ctx.ariel.rates(), config });
    const l0 = runFileRules(l0Ctx, deps);
    state.timings.push(...l0.timings);
    if (l0.findings.length > 0) {
      await rejectFile(ctx, state, l0.findings);
      await writeExecutionReport(ctx, state, "FILE_REJECTED");
      log.info({ findings: l0.findings.map((f) => f.ruleId) }, "file rejected");
      return "FILE_REJECTED";
    }

    // ---- parse: bronze + events_records ----
    await stepParse(ctx, state, parsed, records);
    log.info({ rows: records.length }, "batch parsed");

    // ---- validate: snapshot once, then L1 + provisional derivation + L2 ----
    const snapshot = await takeSnapshot(ctx, state, records);
    state.arielSnapshotHash = snapshot.hash;
    await putOnce(ctx, state.paths.silver.rulesConfig, serializeRulesConfig(config));
    state.outputs.push(state.paths.silver.arielSnapshot, state.paths.silver.rulesConfig);
    // Rates frozen in the snapshot are authoritative so the live run and offline re-validation agree (AC5).
    const rates = snapshot.rates ?? (await ctx.ariel.rates());
    const validation = runValidation({ batch: batchInfo, parsed, records, snapshot, rates, config }, deps);
    state.timings.push(...validation.timings);
    state.ruleSkips.push(...validation.skips.map((s) => ({ ruleId: s.ruleId, lineNumber: s.lineNumber, reason: s.reason })));
    if (validation.skips.length) log.warn({ skips: validation.skips.length, rules: [...new Set(validation.skips.map((s) => s.ruleId))] }, "rules skipped for some rows (see execution report ruleSkips)");
    await stepValidate(ctx, state, parsed, records, validation, config);
    await writeExecutionReport(ctx, state, "VALIDATED");
    log.info({ accepted: state.counts.accepted, rejected: state.counts.rejected, held: state.counts.held }, "batch validated");
    return "VALIDATED";
  } catch (err) {
    // Any exception lands the batch in FAILED (architecture section 10.5); the full error stays in the log.
    const failureRef = ctx.newId();
    log.error({ err, failureRef }, "batch failed");
    const reason = sanitizeFailureReason(err, failureRef);
    try {
      const [current] = await ctx.db.select({ status: batches.status }).from(batches).where(eq(batches.batchId, batchId));
      if (current && current.status !== "FAILED" && current.status !== "FILE_REJECTED") {
        await ctx.db.transaction((tx) =>
          transitionBatch(tx, { batchId, from: current.status, to: "FAILED", actor: ACTOR, at: ctx.clock().toISOString(), note: reason, failureReason: reason }),
        );
      }
    } catch (transitionErr) {
      log.error({ err: transitionErr, failureRef }, "could not record the FAILED transition");
    }
    try {
      await writeExecutionReport(ctx, state, "FAILED", reason);
    } catch {
      // report writing is best-effort on failure
    }
    return "FAILED";
  }
}

/** Snapshot is write-once: a retry reuses the persisted one so re-validation is reproducible (AC5). */
async function takeSnapshot(ctx: AppContext, state: RunState, records: EventsRecord[]): Promise<ArielBatchSnapshot> {
  const path = state.paths.silver.arielSnapshot;
  if (await ctx.lake.exists(path)) {
    ctx.logger.warn({ path }, "reusing persisted Ariel snapshot from a previous attempt");
    return InMemoryArielSnapshot.fromNdjson((await ctx.lake.get(path)).toString("utf8"), state.batch.batchId);
  }
  const sins = records.map((r) => r.sinPseudo).filter((s): s is string => Boolean(s));
  const snapshot = await ctx.ariel.snapshotForBatch(state.batch.batchId, state.batch.employerId, sins);
  await ctx.lake.put(path, snapshot.toNdjson());
  return snapshot;
}

async function rejectFile(ctx: AppContext, state: RunState, findings: ValidationFinding[]): Promise<void> {
  const { batch } = state;
  const at = ctx.clock().toISOString();
  state.counts.fileErrors = findings.length;
  state.counts.findings = findings.length;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(validationFindings).values(findings.map((f, i) => findingRow({ ...f, sortOrder: i })));
    await tx.update(batches).set({ rulesConfigHash: state.rulesConfigHash || null, arielAdapter: state.arielAdapter, updatedAt: at }).where(eq(batches.batchId, batch.batchId));
    await transitionBatch(tx, { batchId: batch.batchId, from: "RECEIVED", to: "FILE_REJECTED", actor: ACTOR, at, note: findings.map((f) => `${f.ruleId}/${f.messageId}`).join(", ") });
    await ctx.ledger.append(
      {
        streamId: batchStream(batch.batchId),
        eventType: "BatchFileRejected",
        batchId: batch.batchId,
        actor: ACTOR,
        payload: { sha256: state.rawFile.sha256, findings: sortSummaries(findings.map(summarize)) },
      },
      tx,
    );
  });
}

/** Bronze/silver are write-once; an Admin retry of a FAILED batch reuses artifacts the failed attempt already wrote. */
async function putOnce(ctx: AppContext, path: string, data: string | Buffer): Promise<void> {
  if (await ctx.lake.exists(path)) {
    ctx.logger.warn({ path }, "lake artifact already exists from a previous attempt; reusing it");
    return;
  }
  await ctx.lake.put(path, data);
}

async function stepParse(ctx: AppContext, state: RunState, parsed: ParsedEventsFile, records: EventsRecord[]): Promise<void> {
  const { batch, paths } = state;
  const at = ctx.clock().toISOString();
  const headerJson = {
    observed: parsed.header.observed,
    missing: parsed.header.missing,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    lineCount: parsed.lineCount,
    rows: parsed.rows.length,
  };
  await putOnce(ctx, paths.bronze.header, JSON.stringify(headerJson, null, 2));
  await putOnce(ctx, paths.bronze.records, ndjson(records.map(publicRecord)));
  const parseErrors = records.filter((r) => !recordParseOk(r) || r.extraValues.length > 0).map((r) => ({ lineNumber: r.lineNumber, sinMasked: r.sinMasked, extraValues: r.extraValues, rawValues: maskedRawValues(r) }));
  await putOnce(ctx, paths.bronze.parseErrors, ndjson(parseErrors));
  state.outputs.push(paths.bronze.header, paths.bronze.records, paths.bronze.parseErrors);

  await ctx.db.transaction(async (tx) => {
    for (const part of chunk(records, INSERT_CHUNK)) {
      await tx.insert(eventsRecords).values(
        part.map((r) => ({
          recordId: r.recordId,
          batchId: r.batchId,
          lineNumber: r.lineNumber,
          sinPseudo: r.sinPseudo,
          sinMasked: r.sinMasked,
          sinEnc: r.sin ? encryptSin(ctx.config.sinEncKey, r.sin) : null,
          lastName: r.lastName,
          firstName: r.firstName,
          eventType: r.eventType ?? null,
          employmentEndDate: r.employmentEndDate ?? null,
          dateOfDeath: r.dateOfDeath ?? null,
          eventYear: r.eventYear ?? null,
          cyWeeks: r.currentYear.weeks ?? null,
          cyLow: r.currentYear.lowContributions ?? null,
          cyHigh: r.currentYear.highContributions ?? null,
          cyAe: r.currentYear.annualizedEarnings ?? null,
          cyPa: r.currentYear.pa ?? null,
          pyWeeks: r.previousYear.weeks ?? null,
          pyLow: r.previousYear.lowContributions ?? null,
          pyHigh: r.previousYear.highContributions ?? null,
          pyAe: r.previousYear.annualizedEarnings ?? null,
          pyPa: r.previousYear.pa ?? null,
          rawValues: maskedRawValues(r),
          parseOk: recordParseOk(r),
          accepted: null,
          outcome: null,
        })),
      );
    }
    await tx.update(batches).set({ rowsTotal: records.length, updatedAt: at }).where(eq(batches.batchId, batch.batchId));
    await transitionBatch(tx, { batchId: batch.batchId, from: "RECEIVED", to: "PARSED", actor: ACTOR, at, note: "bronze written" });
    await ctx.ledger.append(
      {
        streamId: batchStream(batch.batchId),
        eventType: "BatchParsed",
        batchId: batch.batchId,
        actor: ACTOR,
        payload: { sha256: state.rawFile.sha256, encoding: parsed.encoding, header: parsed.header.observed, rows: records.length, parseOk: records.filter(recordParseOk).length },
      },
      tx,
    );
  });
}

async function stepValidate(ctx: AppContext, state: RunState, parsed: ParsedEventsFile, records: EventsRecord[], v: ValidationOutput, config: RulesConfig): Promise<void> {
  const { batch, paths } = state;
  const at = ctx.clock().toISOString();
  const allFindings = v.findings;
  state.counts.accepted = v.accepted.length;
  state.counts.rejected = v.rejected.length;
  state.counts.held = v.held.length;
  state.counts.findings = allFindings.length;
  state.counts.memberErrors = allFindings.filter((f) => f.severity === "COMPLETE_MEMBER_ERROR").length;
  state.counts.warnings = allFindings.filter((f) => f.severity === "WARNING").length;
  state.counts.infos = allFindings.filter((f) => f.severity === "INFORMATION").length;

  await putOnce(ctx, paths.silver.findings, ndjson(allFindings.map(lakeFinding)));
  await putOnce(ctx, paths.silver.accepted, ndjson(v.accepted.map(publicRecord)));
  await putOnce(ctx, paths.silver.rejected, buildRejectedIndividualsCsv(parsed.header.observed, v.rejected, parsed.encoding));
  await writeSummaryReports(ctx, paths, allFindings);
  state.outputs.push(paths.silver.findings, paths.silver.accepted, paths.silver.rejected, paths.gold.summaryOfValidations, paths.gold.summaryOfValidationsPrivate);

  await ctx.db.transaction(async (tx) => {
    for (const part of chunk(allFindings, INSERT_CHUNK)) {
      await tx.insert(validationFindings).values(part.map(findingRow));
    }
    for (const r of records) {
      const outcome = v.outcomes.get(r.recordId) ?? "REJECTED";
      await tx.update(eventsRecords).set({ accepted: outcome === "HELD" ? null : outcome === "ACCEPTED", outcome }).where(eq(eventsRecords.recordId, r.recordId));
    }
    await tx
      .update(batches)
      .set({
        rowsAccepted: v.accepted.length,
        rowsRejected: v.rejected.length,
        heldTotal: v.held.length,
        warningsTotal: state.counts.warnings,
        infosTotal: state.counts.infos,
        rulesConfigHash: config.hash,
        arielSnapshotHash: state.arielSnapshotHash,
        arielAdapter: state.arielAdapter,
        updatedAt: at,
      })
      .where(eq(batches.batchId, batch.batchId));
  });

  // Member outcomes, chunked per transaction. HELD rows are ledgered once their last override lands.
  for (const part of chunk(v.rejected, LEDGER_CHUNK)) {
    await ctx.ledger.appendMany(
      part.map((r) => ({
        streamId: r.sinPseudo ? memberStream(r.sinPseudo) : batchStream(batch.batchId),
        eventType: "MemberRecordRejected" as const,
        batchId: batch.batchId,
        actor: ACTOR,
        payload: {
          recordId: r.recordId,
          lineNumber: r.lineNumber,
          sinMasked: r.sinMasked,
          eventType: r.eventType ?? null,
          eventDate: r.eventDate ?? null,
          findings: sortSummaries((v.recordFindings.get(r.recordId) ?? []).map(summarize)),
        },
      })),
    );
  }
  for (const part of chunk(v.accepted, LEDGER_CHUNK)) {
    await ctx.ledger.appendMany(
      part.map((r) => ({
        streamId: r.sinPseudo ? memberStream(r.sinPseudo) : batchStream(batch.batchId),
        eventType: "MemberRecordValidated" as const,
        batchId: batch.batchId,
        actor: ACTOR,
        payload: validatedPayload(r, v.recordFindings.get(r.recordId) ?? [], config.hash, state.arielSnapshotHash) as unknown as Record<string, unknown>,
      })),
    );
  }

  await ctx.db.transaction((tx) =>
    transitionBatch(tx, { batchId: batch.batchId, from: "PARSED", to: "VALIDATED", actor: ACTOR, at: ctx.clock().toISOString(), note: `accepted=${v.accepted.length} rejected=${v.rejected.length} held=${v.held.length}` }),
  );
}

/** Summary of Validations public + private CSVs (architecture section 10.6). Regenerated after overrides. */
export async function writeSummaryReports(ctx: AppContext, paths: LakePaths, findings: ValidationFinding[]): Promise<void> {
  await ctx.lake.put(paths.gold.summaryOfValidations, buildSummaryOfValidationsCsv(findings, { includePrivate: false }), { overwrite: true });
  await ctx.lake.put(paths.gold.summaryOfValidationsPrivate, buildSummaryOfValidationsCsv(findings, { includePrivate: true }), { overwrite: true });
}

async function writeExecutionReport(ctx: AppContext, state: RunState, status: BatchStatus, failureReason?: string): Promise<void> {
  const endedAt = ctx.clock();
  const { batch, rawFile, paths } = state;
  const report: ExecutionReport = {
    schemaVersion: 1,
    batchId: batch.batchId,
    status,
    startedAt: state.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - state.startedAt.getTime(),
    parameters: {
      employerId: batch.employerId,
      executionDate: batch.executionDate,
      sourceSystem: batch.sourceSystem,
      uploadedBy: batch.uploadedBy,
      rulesConfigHash: state.rulesConfigHash,
      arielAdapter: state.arielAdapter,
      ...(state.arielSnapshotHash ? { arielSnapshotHash: state.arielSnapshotHash } : {}),
    },
    input: {
      originalFilename: rawFile.originalFilename,
      sha256: rawFile.sha256,
      sizeBytes: Number(rawFile.sizeBytes),
      encodingDetected: state.encoding,
      lineCount: state.lineCount,
    },
    outputs: [...state.outputs, paths.gold.executionReportJson, paths.gold.executionReportHtml],
    counts: state.counts,
    rules: state.timings,
    ...(state.ruleSkips.length ? { ruleSkips: state.ruleSkips } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
  await ctx.lake.put(paths.gold.executionReportJson, JSON.stringify(report, null, 2), { overwrite: true });
  await ctx.lake.put(paths.gold.executionReportHtml, renderExecutionReportHtml(report), { overwrite: true });
}

export { todayIso };