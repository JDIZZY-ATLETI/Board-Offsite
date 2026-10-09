import { eq } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { sha256Hex } from "@/lib/crypto/hash";
import { batches, eventsRecords, rawFiles, validationFindings } from "@/lib/db/schema";
import { parseEventsCsv, type ParsedEventsFile } from "@/lib/events/parse";
import { buildRecord, maskedRawValues, recordParseOk } from "@/lib/events/record";
import { todayIso } from "@/lib/events/fields";
import { lakePaths, type LakePaths } from "@/lib/lake/paths";
import { batchStream, memberStream, systemActor } from "@/lib/ledger/streams";
import { encryptSin } from "@/lib/pii/sin";
import { buildSinCounts, evaluateRecords, runFileRules, type EngineDeps } from "@/lib/rules/engine";
import type { RuleContext } from "@/lib/rules/types";
import type { BatchStatus, EventsRecord, ExecutionReport, FindingSummary, IsoDate, RecordOutcome, RuleTiming, ValidationFinding } from "@/types";
import { buildRejectedIndividualsCsv } from "./csv-out";
import { renderExecutionReportHtml } from "./execution-report";
import { transitionBatch } from "./state-machine";

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
  counts: ExecutionReport["counts"];
  lineCount: number;
  encoding: string;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function summarize(f: ValidationFinding): FindingSummary {
  return { ruleId: f.ruleId, messageId: f.messageId, field: f.field, yearScope: f.yearScope, params: f.params };
}

function sortSummaries(list: FindingSummary[]): FindingSummary[] {
  return [...list].sort((a, b) => a.ruleId.localeCompare(b.ruleId) || (a.field ?? "").localeCompare(b.field ?? "") || (a.yearScope ?? "").localeCompare(b.yearScope ?? ""));
}

function findingRow(f: ValidationFinding) {
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

function ndjson(items: unknown[]): string {
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

/** Runs parse -> validateL1 -> finalize for a RECEIVED batch (architecture section 10.2). */
export async function runBatch(ctx: AppContext, batchId: string): Promise<BatchStatus> {
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
    paths: lakePaths({ employerId: batch.employerId, batchId, ingestDate: batch.receivedAt.slice(0, 10) as IsoDate }),
    startedAt: ctx.clock(),
    outputs: [rawFile.lakePath],
    timings: [],
    counts: { linesRead: 0, rows: 0, accepted: 0, rejected: 0, fileErrors: 0, memberErrors: 0, warnings: 0, infos: 0, findings: 0 },
    lineCount: 0,
    encoding: rawFile.encodingDetected,
  };
  const deps: EngineDeps = { newId: ctx.newId, now: ctx.clock };
  try {
    const bytes = await ctx.lake.get(rawFile.lakePath);
    const actualSha = sha256Hex(bytes);
    if (actualSha !== rawFile.sha256) throw new PipelineError(`raw file sha256 mismatch: manifest ${rawFile.sha256} vs lake ${actualSha}`);
    const parsed = parseEventsCsv(bytes);
    state.lineCount = parsed.lineCount;
    state.encoding = parsed.encoding;
    state.counts.linesRead = parsed.lineCount;
    state.counts.rows = parsed.rows.length;

    const records = parsed.rows.map((row) => buildRecord(row, { batchId, pseudonymKey: ctx.config.sinPseudonymKey, newId: ctx.newId }));
    const ruleCtx: RuleContext = {
      batch: { batchId, employerId: batch.employerId, executionDate: batch.executionDate as IsoDate },
      file: { header: parsed.header.observed, rows: parsed.rows, records, encodingProblem: parsed.encodingProblem },
      config: { i42ApplyToRetfin: ctx.config.i42ApplyToRetfin, disabled: ctx.config.rulesDisabled },
      now: () => batch.executionDate as IsoDate,
      sinCounts: buildSinCounts(records),
    };

    // ---- L0 ----
    const l0 = runFileRules(ruleCtx, deps);
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

    // ---- validate: L1 (+ Ariel-free L2) ----
    const evaluation = evaluateRecords(ruleCtx, deps);
    state.timings.push(...evaluation.timings);
    await stepValidate(ctx, state, parsed, records, evaluation.recordFindings, evaluation.outcomes);
    await writeExecutionReport(ctx, state, "VALIDATED");
    log.info({ accepted: state.counts.accepted, rejected: state.counts.rejected }, "batch validated");
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

async function rejectFile(ctx: AppContext, state: RunState, findings: ValidationFinding[]): Promise<void> {
  const { batch } = state;
  const at = ctx.clock().toISOString();
  state.counts.fileErrors = findings.length;
  state.counts.findings = findings.length;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(validationFindings).values(findings.map((f, i) => findingRow({ ...f, sortOrder: i })));
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

async function stepValidate(
  ctx: AppContext,
  state: RunState,
  parsed: ParsedEventsFile,
  records: EventsRecord[],
  recordFindings: Map<string, ValidationFinding[]>,
  outcomes: Map<string, RecordOutcome>,
): Promise<void> {
  const { batch, paths } = state;
  const at = ctx.clock().toISOString();
  const allFindings: ValidationFinding[] = [];
  for (const r of records) {
    const list = recordFindings.get(r.recordId) ?? [];
    list.forEach((f, i) => allFindings.push({ ...f, sortOrder: i }));
  }
  const accepted = records.filter((r) => outcomes.get(r.recordId) === "ACCEPTED");
  const rejected = records.filter((r) => outcomes.get(r.recordId) === "REJECTED");
  state.counts.accepted = accepted.length;
  state.counts.rejected = rejected.length;
  state.counts.findings = allFindings.length;
  state.counts.memberErrors = allFindings.filter((f) => f.severity === "COMPLETE_MEMBER_ERROR").length;
  state.counts.warnings = allFindings.filter((f) => f.severity === "WARNING").length;
  state.counts.infos = allFindings.filter((f) => f.severity === "INFORMATION").length;

  await putOnce(ctx, paths.silver.findings, ndjson(allFindings));
  await putOnce(ctx, paths.silver.accepted, ndjson(accepted.map(publicRecord)));
  await putOnce(ctx, paths.silver.rejected, buildRejectedIndividualsCsv(parsed.header.observed, rejected, parsed.encoding));
  state.outputs.push(paths.silver.findings, paths.silver.accepted, paths.silver.rejected);

  await ctx.db.transaction(async (tx) => {
    for (const part of chunk(allFindings, INSERT_CHUNK)) {
      await tx.insert(validationFindings).values(part.map(findingRow));
    }
    for (const r of records) {
      await tx.update(eventsRecords).set({ accepted: outcomes.get(r.recordId) === "ACCEPTED" }).where(eq(eventsRecords.recordId, r.recordId));
    }
    await tx
      .update(batches)
      .set({ rowsAccepted: accepted.length, rowsRejected: rejected.length, warningsTotal: state.counts.warnings, infosTotal: state.counts.infos, updatedAt: at })
      .where(eq(batches.batchId, batch.batchId));
  });

  // Member outcomes for L1 rejects (architecture section 17 Phase 1), chunked per transaction.
  for (const part of chunk(rejected, LEDGER_CHUNK)) {
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
          findings: sortSummaries((recordFindings.get(r.recordId) ?? []).map(summarize)),
        },
      })),
    );
  }

  await ctx.db.transaction((tx) =>
    transitionBatch(tx, { batchId: batch.batchId, from: "PARSED", to: "VALIDATED", actor: ACTOR, at: ctx.clock().toISOString(), note: `accepted=${accepted.length} rejected=${rejected.length}` }),
  );
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
      rulesConfigHash: sha256Hex(JSON.stringify({ i42ApplyToRetfin: ctx.config.i42ApplyToRetfin, disabled: [...ctx.config.rulesDisabled].sort() })),
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
    ...(failureReason ? { failureReason } : {}),
  };
  await ctx.lake.put(paths.gold.executionReportJson, JSON.stringify(report, null, 2), { overwrite: true });
  await ctx.lake.put(paths.gold.executionReportHtml, renderExecutionReportHtml(report), { overwrite: true });
}

export { todayIso };
