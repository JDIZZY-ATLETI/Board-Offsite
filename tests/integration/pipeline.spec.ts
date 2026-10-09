import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import { batches, eventsRecords, validationFindings } from "@/lib/db/schema";
import { decodeBytes } from "@/lib/events/decode";
import { lakePaths } from "@/lib/lake/paths";
import { decryptSin } from "@/lib/pii/sin";
import { ingest } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/run";
import { manifestSchema } from "@/lib/pipeline/manifest";
import type { ExecutionReport, IsoDate } from "@/types";
import { goldenInput, goldenJson } from "../helpers/fixtures";
import { createTestContext, type TestContext } from "../helpers/test-context";

let t: TestContext;
const ACTOR = "user:es-0235-jsmith";
const EXEC: IsoDate = "2026-10-08";

async function upload(scenario: string, employerId = "0235") {
  const bytes = goldenInput(scenario);
  const r = await ingest(t.ctx, { bytes, filename: `${scenario}.csv`, employerId, submittedBy: ACTOR, executionDate: EXEC });
  if (r.duplicate) throw new Error("unexpected duplicate");
  const status = await runBatch(t.ctx, r.batchId);
  const [batch] = await t.ctx.db.select().from(batches).where(eq(batches.batchId, r.batchId));
  const paths = lakePaths({ employerId, batchId: r.batchId, ingestDate: batch.receivedAt.slice(0, 10) as IsoDate });
  return { bytes, batchId: r.batchId, status, batch, paths, sha256: r.sha256 };
}

function lakeFile(rel: string): Buffer {
  return readFileSync(path.join(t.lakeRoot, ...rel.split("/")));
}

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.cleanup());

describe("pipeline: happy-terfin", () => {
  it("goes RECEIVED -> PARSED -> VALIDATED with all rows accepted and every lake artifact present", async () => {
    const u = await upload("happy-terfin");
    expect(u.status).toBe("VALIDATED");
    expect(u.batch.status).toBe("VALIDATED");
    expect(u.batch.rowsTotal).toBe(5);
    expect(u.batch.rowsAccepted).toBe(5);
    expect(u.batch.rowsRejected).toBe(0);

    // raw + manifest with matching sha256
    expect(sha256Hex(lakeFile(u.paths.raw.original))).toBe(u.sha256);
    expect(sha256Hex(u.bytes)).toBe(u.sha256);
    const manifest = manifestSchema.parse(JSON.parse(lakeFile(u.paths.raw.manifest).toString()));
    expect(manifest.sha256).toBe(u.sha256);
    expect(manifest.encodingDetected).toBe("windows-1252");
    expect(manifest.lineCount).toBe(6);
    expect(manifest.executionDate).toBe(EXEC);

    // bronze / silver / gold
    for (const p of [u.paths.bronze.header, u.paths.bronze.records, u.paths.bronze.parseErrors, u.paths.silver.findings, u.paths.silver.accepted, u.paths.silver.rejected, u.paths.gold.executionReportJson, u.paths.gold.executionReportHtml]) {
      expect(await t.ctx.lake.exists(p), p).toBe(true);
    }
    const records = lakeFile(u.paths.bronze.records).toString().trim().split("\n").map((l) => JSON.parse(l));
    expect(records).toHaveLength(5);
    expect(records[0].lastName).toBe("C\u00d4T\u00c9");
    expect(records[0].sinMasked).toBe("***-***-019");
    expect(JSON.stringify(records)).not.toContain("900000019");

    // Rejected Individuals is header-only when nothing is rejected
    const rejected = decodeBytes(lakeFile(u.paths.silver.rejected)).text.trim().split("\r\n");
    expect(rejected).toHaveLength(1);

    const report: ExecutionReport = JSON.parse(lakeFile(u.paths.gold.executionReportJson).toString());
    expect(report.status).toBe("VALIDATED");
    expect(report.input.sha256).toBe(u.sha256);
    expect(report.counts).toMatchObject({ rows: 5, accepted: 5, rejected: 0, findings: 0 });
    expect(report.rules.find((r) => r.ruleId === "I1")?.evaluations).toBe(5);
    expect(lakeFile(u.paths.gold.executionReportHtml).toString()).toContain("Execution Report");

    // status history and ledger
    const history = (await import("@/lib/queries/batches")).getBatchDetail;
    const detail = await history(t.ctx, u.batchId);
    expect(detail?.statusHistory.map((h) => h.toStatus)).toEqual(["RECEIVED", "PARSED", "VALIDATED"]);
    expect(detail?.reports.map((r) => r.name)).toContain("execution-report.json");
    const entries = await t.ctx.ledger.list({ batchId: u.batchId, order: "asc" });
    expect(entries.items.map((e) => e.eventType)).toEqual(["BatchReceived", "BatchParsed"]);
    expect(entries.items[0].payload).toMatchObject({ sha256: u.sha256, employerId: "0235", uploadedBy: ACTOR });
  });

  it("stores no raw SIN in events_records (only pseudonym, mask and ciphertext)", async () => {
    const rows = await t.ctx.db.select().from(eventsRecords);
    expect(rows.length).toBeGreaterThan(0);
    const fixtureSins = decodeBytes(goldenInput("happy-terfin")).text.split("\r\n").slice(1).filter(Boolean).map((l) => l.split(",")[0]);
    for (const r of rows) {
      const serialised = JSON.stringify({ ...r, sinEnc: undefined });
      for (const s of fixtureSins) expect(serialised).not.toContain(s);
      expect(r.sinPseudo).toMatch(/^[0-9a-f]{64}$/);
      expect(r.sinMasked).toMatch(/^\*\*\*-\*\*\*-\d{3}$/);
      expect(r.rawValues.SIN).toBe(r.sinMasked);
      expect(r.sinEnc).not.toBeNull();
    }
    // but the ciphertext decrypts for the Rejected Individuals / export writers
    const first = rows.find((r) => r.sinMasked === "***-***-019")!;
    expect(decryptSin(t.ctx.config.sinEncKey, first.sinEnc!)).toBe("900000019");
  });

  it("writes no raw SIN to the logs", () => {
    const all = t.logs.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const s of ["900000019", "900000027", "900000035"]) expect(all).not.toContain(s);
  });

  it("re-uploading the same bytes returns duplicate:true, creates no batch and ledgers the attempt", async () => {
    const before = await t.ctx.db.select().from(batches);
    const r = await ingest(t.ctx, { bytes: goldenInput("happy-terfin"), filename: "again.csv", employerId: "0235", submittedBy: "user:someone-else", executionDate: EXEC });
    expect(r.duplicate).toBe(true);
    const after = await t.ctx.db.select().from(batches);
    expect(after).toHaveLength(before.length);
    const existing = before.find((b) => b.fileSha256 === r.sha256)!;
    expect(r.batchId).toBe(existing.batchId);
    const entries = await t.ctx.ledger.list({ batchId: existing.batchId, order: "asc" });
    const last = entries.items[entries.items.length - 1];
    expect(last.eventType).toBe("BatchReceived");
    expect(last.payload).toMatchObject({ duplicateOf: existing.batchId, uploadedBy: "user:someone-else" });
  });

  it("the same bytes from a different employer is a new batch", async () => {
    const r = await ingest(t.ctx, { bytes: goldenInput("happy-terfin"), filename: "x.csv", employerId: "0359", submittedBy: ACTOR, executionDate: EXEC });
    expect(r.duplicate).toBe(false);
  });
});

describe("pipeline: happy-decfin / happy-retfin", () => {
  it("DECFIN rows are accepted with EmploymentEndDate as the event date (Q1)", async () => {
    const u = await upload("happy-decfin");
    expect(u.status).toBe("VALIDATED");
    expect(u.batch.rowsAccepted).toBe(3);
    const rows = await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, u.batchId));
    expect(rows.every((r) => r.eventType === "DECFIN" && r.dateOfDeath === r.employmentEndDate)).toBe(true);
  });
  it("RETFIN rows are accepted", async () => {
    const u = await upload("happy-retfin");
    expect(u.status).toBe("VALIDATED");
    expect(u.batch.rowsAccepted).toBe(3);
  });
});

describe("pipeline: file-rejected-*", () => {
  it("bad header -> FILE_REJECTED with I51/4887, no records, BatchFileRejected ledgered, execution report written", async () => {
    const u = await upload("file-rejected-header");
    expect(u.status).toBe("FILE_REJECTED");
    expect(u.batch.status).toBe("FILE_REJECTED");
    const findings = await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, u.batchId));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "I51", messageId: "4887", level: "L0", severity: "FILE_ERROR", recordId: null, lineNumber: null });
    expect(findings[0].calculated).toMatchObject({ reason: "INVALID_HEADER", invalidLabels: "LastNme" });
    expect(await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, u.batchId))).toHaveLength(0);
    expect(await t.ctx.lake.exists(u.paths.bronze.records)).toBe(false);
    expect(await t.ctx.lake.exists(u.paths.gold.executionReportJson)).toBe(true);
    const entries = await t.ctx.ledger.list({ batchId: u.batchId, order: "asc" });
    expect(entries.items.map((e) => e.eventType)).toEqual(["BatchReceived", "BatchFileRejected"]);
    expect(entries.items[1].payload).toMatchObject({ findings: [{ ruleId: "I51", messageId: "4887" }] });
  });
  it("extra cells -> FILE_REJECTED with I50/130", async () => {
    const u = await upload("file-rejected-extra-values");
    expect(u.status).toBe("FILE_REJECTED");
    const findings = await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, u.batchId));
    expect(findings.map((f) => f.messageId)).toEqual(["130"]);
    expect(findings[0].calculated).toMatchObject({ firstOffendingLine: 3 });
  });
  it("a FILE_REJECTED upload can be re-submitted after correction (idempotency ignores rejected files)", async () => {
    const r = await ingest(t.ctx, { bytes: goldenInput("file-rejected-header"), filename: "retry.csv", employerId: "0235", submittedBy: ACTOR, executionDate: EXEC });
    expect(r.duplicate).toBe(false);
    expect(await runBatch(t.ctx, r.batchId)).toBe("FILE_REJECTED");
  });
});

describe("pipeline: mixed-100-rows", () => {
  it("triggers every L1 message id at least once and rejects exactly the expected rows", async () => {
    const expected = goldenJson<{ messageIds: string[]; rows: number; accepted: number; rejected: number; rejectedLines: number[] }>("mixed-100-rows", "expected-message-ids.json");
    const u = await upload("mixed-100-rows");
    expect(u.status).toBe("VALIDATED");
    expect(u.batch.rowsTotal).toBe(expected.rows);
    expect(u.batch.rowsRejected).toBe(expected.rejected);
    expect(u.batch.rowsAccepted).toBe(expected.accepted);

    const findings = await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, u.batchId));
    const ids = new Set(findings.map((f) => f.messageId));
    for (const id of expected.messageIds) expect(ids.has(id), `message id ${id} never fired`).toBe(true);
    expect([...ids].sort()).toEqual([...expected.messageIds].sort());

    const records = await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, u.batchId));
    const rejectedLines = records.filter((r) => r.accepted === false).map((r) => r.lineNumber).sort((a, b) => a - b);
    expect(rejectedLines).toEqual(expected.rejectedLines);

    // spot checks on message rendering and parameters
    const byLine = (l: number) => findings.filter((f) => f.lineNumber === l);
    expect(byLine(70).map((f) => f.dataImportMessage)).toContain("The field Weeks_CurrentYear exceeds the maximum acceptable length of 5 characters (including decimal point, if applicable).");
    expect(byLine(80)[0].dataImportMessage).toBe("RETIRE is in an invalid code.");
    expect(byLine(81).map((f) => f.messageId)).toEqual(["910"]);
    expect(byLine(82).map((f) => f.messageId)).toEqual(["910"]);
    expect(byLine(81)[0].params).toEqual({ 1: "***-***-994" });
    expect(byLine(101).map((f) => f.messageId).sort()).toEqual(["6503", "9099", "9519"]);
    expect(byLine(69 + 10).find((f) => f.messageId === "5131")?.params).toEqual({ 1: "SIN" });

    // Rejected Individuals mirrors the input rows with raw SIN and the original header
    const rejectedCsv = decodeBytes(lakeFile(u.paths.silver.rejected)).text.trim().split("\r\n");
    const inputLines = decodeBytes(u.bytes).text.trim().split("\r\n");
    expect(rejectedCsv[0]).toBe(inputLines[0]);
    expect(rejectedCsv).toHaveLength(1 + expected.rejected);
    for (const line of expected.rejectedLines) expect(rejectedCsv).toContain(inputLines[line - 1]);

    // one MemberRecordRejected per rejected row, each listing its findings, no raw SIN in payloads
    const entries = await t.ctx.ledger.list({ batchId: u.batchId, eventType: "MemberRecordRejected", limit: 200 });
    expect(entries.items).toHaveLength(expected.rejected);
    const noSin = entries.items.find((e) => (e.payload as { lineNumber: number }).lineNumber === 69);
    expect(noSin?.streamId).toBe(`batch:${u.batchId}`);
    for (const e of entries.items) {
      const s = JSON.stringify(e.payload);
      expect(s).not.toMatch(/"9000\d{5}"/);
      expect(e.streamId.startsWith("member:") || e.streamId.startsWith("batch:")).toBe(true);
    }
    const report: ExecutionReport = JSON.parse(lakeFile(u.paths.gold.executionReportJson).toString());
    expect(report.counts.rejected).toBe(expected.rejected);
    expect(report.rules.map((r) => r.ruleId)).toContain("I42");
  });

  it("the whole chain still verifies after all scenarios", async () => {
    const v = await t.ctx.ledger.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(v.headSeq);
    expect(v.checked).toBeGreaterThan(40);
  });
});
