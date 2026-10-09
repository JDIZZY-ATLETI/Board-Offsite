import { writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { batches, batchStatusHistory, eventsRecords, rawFiles } from "@/lib/db/schema";
import { ingest } from "@/lib/pipeline/ingest";
import { PipelineError, runBatch, sanitizeFailureReason } from "@/lib/pipeline/run";
import { canTransition, InvalidTransitionError, TRANSITIONS, transitionBatch } from "@/lib/pipeline/state-machine";
import { BATCH_STATUSES, type BatchStatus } from "@/types";
import { goldenInput } from "../helpers/fixtures";
import { ADMIN, api, csvBytes, expectErrorEnvelope, expectLegalBatchState, HEADER, manyRows, REVIEWER, SUB_0235, upload, uploadRaw, validRow } from "../helpers/qa-api";
import { createTestContext, type TestContext } from "../helpers/test-context";

/**
 * QA: adversarial inputs to POST /api/batches (plan item 3) and state-machine legality (plan item 4).
 * Every upload must end with a well-formed envelope or a batch in a legal section 10.1 state.
 */

let t: TestContext;
const F = { employerId: "0235", executionDate: "2026-10-08" };
const created: string[] = [];

async function up(bytes: Buffer, opts: { filename?: string; type?: string; fields?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const r = await upload(bytes, opts.headers ?? ADMIN, opts.fields ?? F, { filename: opts.filename, type: opts.type });
  if (r.body?.batchId) created.push(r.body.batchId);
  return r;
}

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.cleanup());

describe("QA/upload: degenerate files", () => {
  it("COS-2 (fixed): a 0-byte file is refused at the boundary with 400 EMPTY_FILE and no batch is created", async () => {
    const before = (await t.ctx.db.select({ id: batches.batchId }).from(batches)).length;
    const r = await up(Buffer.alloc(0), { filename: "empty.csv" });
    expectErrorEnvelope(r, 400, "EMPTY_FILE");
    expect((await t.ctx.db.select({ id: batches.batchId }).from(batches)).length).toBe(before);
  });
  it("whitespace-only file -> FILE_REJECTED (I51 EMPTY_FILE) with no records", async () => {
    const r = await up(Buffer.from(" "), { filename: "space.csv" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("FILE_REJECTED");
    await expectLegalBatchState(t, r.body.batchId);
    const f = await api.findings(ADMIN, r.body.batchId);
    expect(f.body.items.map((x: { messageId: string }) => x.messageId)).toEqual(["4887"]);
    expect(f.body.items[0].calculated).toMatchObject({ reason: "EMPTY_FILE" });
  });
  it("whitespace-only and blank-lines-only files -> FILE_REJECTED", async () => {
    for (const s of ["   ", "\r\n\r\n", "\n"]) {
      const r = await up(Buffer.from(s), { filename: "ws.csv" });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("FILE_REJECTED");
      await expectLegalBatchState(t, r.body.batchId);
    }
  });
  it("header-only file -> VALIDATED with zero rows and all artifacts", async () => {
    const r = await up(Buffer.from(HEADER + "\r\n"), { filename: "header-only.csv" });
    expect(r.body.status).toBe("VALIDATED");
    const b = await api.getBatch(ADMIN, r.body.batchId);
    expect(b.body.counts).toMatchObject({ rows: 0, accepted: 0, rejected: 0 });
    expect(b.body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RECEIVED", "PARSED", "VALIDATED"]);
    expect((await api.report(ADMIN, r.body.batchId, "rejected.csv")).status).toBe(200);
  });
  it("single valid row -> VALIDATED, 1 accepted", async () => {
    const r = await up(csvBytes([validRow(1)]), { filename: "one.csv" });
    expect(r.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, r.body.batchId)).body.counts).toMatchObject({ rows: 1, accepted: 1, rejected: 0 });
  });
  it("1,000 generated rows -> VALIDATED (timing recorded)", async () => {
    const t0 = Date.now();
    const r = await up(csvBytes(manyRows(1000, 10_000)), { filename: "k1.csv" });
    const ms = Date.now() - t0;
    expect(r.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, r.body.batchId)).body.counts.rows).toBe(1000);
    console.info(`[perf] 1,000 rows upload->VALIDATED (route, wait=true): ${ms} ms`);
    expect(ms).toBeLessThan(60_000);
  });
});

describe("QA/upload: not-a-CSV payloads", () => {
  it("ZIP (xlsx renamed .csv), OLE (xls), PDF and EXE signatures are refused with 415 envelopes", async () => {
    const sigs: Array<[string, Buffer]> = [
      ["xlsx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)])],
      ["xls", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64, 1)])],
      ["pdf", Buffer.from("%PDF-1.7\n%....")],
      ["exe", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0)])],
    ];
    for (const [k, b] of sigs) {
      const r = await up(b, { filename: `${k}.csv` });
      expectErrorEnvelope(r, 415, "UNSUPPORTED_MEDIA_TYPE");
    }
  });
  it("random binary without a known signature never 500s: it becomes a FILE_REJECTED batch", async () => {
    const noise = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7919 + 13) % 251 + 1));
    const r = await up(noise, { filename: "noise.csv" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("FILE_REJECTED");
    await expectLegalBatchState(t, r.body.batchId);
  });
  it("BUG-PIPE-1 (fixed): UTF-16 LE/BE with or without BOM -> FILE_REJECTED with I51 UNSUPPORTED_ENCODING, never FAILED", async () => {
    const variants: Array<[string, Buffer, string]> = [
      ["utf16le-nobom", Buffer.from(HEADER + "\r\n", "utf16le"), "UTF16_LE"],
      ["utf16le-bom", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(HEADER + " \r\n", "utf16le")]), "UTF16_LE"],
      ["utf16be-bom", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(HEADER + "\r\n", "utf16le").swap16()]), "UTF16_BE"],
      ["utf16be-nobom", Buffer.from(HEADER + "  \r\n", "utf16le").swap16(), "UTF16_BE"],
    ];
    for (const [name, bytes, detected] of variants) {
      const r = await up(bytes, { filename: `${name}.csv` });
      expect(r.status, name).toBe(200);
      expect(r.body.status, name).toBe("FILE_REJECTED");
      await expectLegalBatchState(t, r.body.batchId);
      const f = await api.findings(SUB_0235, r.body.batchId);
      expect(f.body.items.map((x: { messageId: string }) => x.messageId), name).toEqual(["4887"]);
      expect(f.body.items[0].calculated, name).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected });
      const b = await api.getBatch(SUB_0235, r.body.batchId);
      expect(b.body.failureReason ?? null).toBeNull();
      expect(b.body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RECEIVED", "FILE_REJECTED"]);
    }
  });
  it("BUG-PIPE-2 (fixed): a NUL byte inside a data cell -> 200 FILE_REJECTED (I51 NUL_BYTES), no orphan, and the bytes can be re-uploaded", async () => {
    const bytes = csvBytes([validRow(17, { LastName: "AB\u0000LE" })]);
    const nul = await up(bytes, { filename: "nul-cell.csv" });
    expect(nul.status).toBe(200);
    expect(nul.body.status).toBe("FILE_REJECTED");
    await expectLegalBatchState(t, nul.body.batchId);
    const f = await api.findings(ADMIN, nul.body.batchId);
    expect(f.body.items[0].calculated).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected: "NUL_BYTES" });
    expect(f.text).not.toContain("\\u0000");
    // FILE_REJECTED never deduplicates, so a corrected re-upload of the same bytes is not shadowed.
    const again = await up(bytes, { filename: "nul-cell-2.csv" });
    expect(again.body.duplicate).toBe(false);
    expect(again.body.batchId).not.toBe(nul.body.batchId);
  });
  it("SEC-INFO-1 (fixed): an unexpected pipeline error lands in FAILED with a sanitised failureReason (reference only, full error in the log)", async () => {
    const r = await ingest(t.ctx, { bytes: csvBytes([validRow(18)]), filename: "driver-error.csv", employerId: "0235", submittedBy: "user:qa", executionDate: "2026-10-08" });
    if (r.duplicate) throw new Error("unexpected duplicate");
    created.push(r.batchId);
    const origPut = t.ctx.lake.put.bind(t.ctx.lake);
    t.ctx.lake.put = async (p, data, opts) => {
      if (p.startsWith("bronze/")) throw new Error(`insert into "events_records" ("record_id") values ($1) params: 900000018,SECRET-DRIVER-DETAIL`);
      return origPut(p, data, opts);
    };
    try {
      expect(await runBatch(t.ctx, r.batchId)).toBe("FAILED");
    } finally {
      t.ctx.lake.put = origPut;
    }
    const b = await api.getBatch(SUB_0235, r.batchId);
    expect(b.body.status).toBe("FAILED");
    expect(b.body.failureReason).toMatch(/^Processing failed unexpectedly\. Reference [0-9a-f-]{36}/);
    expect(b.text).not.toMatch(/insert into|params:|SECRET-DRIVER-DETAIL|900000018/);
    expect(t.logs.some((l) => l.includes("SECRET-DRIVER-DETAIL") && l.includes("failureRef"))).toBe(true);
    expect(sanitizeFailureReason(new PipelineError("raw file sha256 mismatch\u0000x"), "ref")).toBe("raw file sha256 mismatch x");
    expect(sanitizeFailureReason("select 1", "ref-1")).toBe("Processing failed unexpectedly. Reference ref-1 - details are in the server log.");
  });
  it("BUG-PIPE-3 (fixed): a FAILED batch deduplicates, and Admin POST /retry (architecture section 11) re-runs it to VALIDATED on the same batchId", async () => {
    const bytes = csvBytes([validRow(19)]);
    const r = await ingest(t.ctx, { bytes, filename: "retry.csv", employerId: "0235", submittedBy: "user:qa", executionDate: "2026-10-08" });
    if (r.duplicate) throw new Error("unexpected duplicate");
    created.push(r.batchId);
    const origPut = t.ctx.lake.put.bind(t.ctx.lake);
    t.ctx.lake.put = async (p, data, opts) => {
      if (p.startsWith("silver/")) throw new Error("disk full");
      return origPut(p, data, opts);
    };
    try {
      expect(await runBatch(t.ctx, r.batchId)).toBe("FAILED");
    } finally {
      t.ctx.lake.put = origPut;
    }
    // Same bytes still point at the FAILED batch (unique index); the way out is the Admin retry.
    expect((await up(bytes, { filename: "retry-again.csv" })).body).toMatchObject({ duplicate: true, batchId: r.batchId });
    expectErrorEnvelope(await api.retry(SUB_0235, r.batchId), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.retry(REVIEWER, r.batchId), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.retry({}, r.batchId), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.retry(ADMIN, "00000000-0000-7000-8000-00000000beef"), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.retry(ADMIN, "nope"), 400);
    const retried = await api.retry(ADMIN, r.batchId);
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ batchId: r.batchId, status: "VALIDATED" });
    const b = await api.getBatch(ADMIN, r.batchId);
    expect(b.body.status).toBe("VALIDATED");
    expect(b.body.failureReason ?? null).toBeNull();
    expect(b.body.counts).toMatchObject({ rows: 1, accepted: 1, rejected: 0 });
    expect(b.body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RECEIVED", "PARSED", "FAILED", "RECEIVED", "PARSED", "VALIDATED"]);
    expect(await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, r.batchId))).toHaveLength(1);
    expectErrorEnvelope(await api.retry(ADMIN, r.batchId), 409, "INVALID_STATE");
    const { auditLog } = await import("@/lib/db/schema");
    expect((await t.ctx.db.select().from(auditLog)).some((a) => a.action === "BATCH_RETRY" && a.target === `batch:${r.batchId}`)).toBe(true);
  });
  it("wrong extension / wrong content type -> 415; charset suffix on text/csv is fine; empty type allowed", async () => {
    expectErrorEnvelope(await up(csvBytes([validRow(2)]), { filename: "events.txt" }), 415);
    expectErrorEnvelope(await up(csvBytes([validRow(2)]), { filename: "events.csv", type: "text/html" }), 415);
    expectErrorEnvelope(await up(csvBytes([validRow(2)]), { filename: "events.CSV.exe" }), 415);
    expect((await up(csvBytes([validRow(3)]), { filename: "EVENTS.CSV", type: "text/csv; charset=utf-8" })).status).toBe(200);
    expect((await up(csvBytes([validRow(4)]), { filename: "e.csv", type: "" })).status).toBe(200);
  });
  it("non-multipart bodies -> 400 INVALID_MULTIPART / FILE_REQUIRED", async () => {
    expectErrorEnvelope(await uploadRaw(ADMIN, JSON.stringify({ file: "x" }), "application/json"), 400, "INVALID_MULTIPART");
    expectErrorEnvelope(await uploadRaw(ADMIN, "SIN,LastName\r\n", "text/csv"), 400, "INVALID_MULTIPART");
    const fd = new FormData();
    fd.set("file", "not a blob");
    fd.set("employerId", "0235");
    expectErrorEnvelope(await uploadRaw(ADMIN, fd), 400, "FILE_REQUIRED");
  });
});

describe("QA/upload: structural variants", () => {
  it("16 header columns -> FILE_REJECTED I51; 14 columns (optional missing) -> VALIDATED", async () => {
    const r16 = await up(Buffer.from(`${HEADER},Extra\r\n${Object.values(validRow(5)).join(",")},x\r\n`), { filename: "c16.csv" });
    expect(r16.body.status).toBe("FILE_REJECTED");
    const cols = HEADER.split(",").slice(0, 14);
    const vals = Object.values(validRow(6)).slice(0, 14);
    const r14 = await up(Buffer.from(`${cols.join(",")}\r\n${vals.join(",")}\r\n`), { filename: "c14.csv" });
    expect(r14.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, r14.body.batchId)).body.counts.accepted).toBe(1);
  });
  it("a data row with 16 fields -> FILE_REJECTED I50 (whole file), firstOffendingLine reported", async () => {
    const r = await up(Buffer.from(`${HEADER}\r\n${Object.values(validRow(7)).join(",")}\r\n${Object.values(validRow(8)).join(",")},EXTRA\r\n`), { filename: "r16.csv" });
    expect(r.body.status).toBe("FILE_REJECTED");
    const f = await api.findings(ADMIN, r.body.batchId);
    expect(f.body.items[0]).toMatchObject({ messageId: "130", calculated: { firstOffendingLine: 3 } });
  });
  it("semicolon- and tab-delimited -> FILE_REJECTED I51", async () => {
    for (const d of [";", "\t"]) {
      const r = await up(Buffer.from(`${HEADER.replace(/,/g, d)}\r\n${Object.values(validRow(9)).join(d)}\r\n`), { filename: "delim.csv" });
      expect(r.body.status).toBe("FILE_REJECTED");
      expect((await api.findings(ADMIN, r.body.batchId)).body.items[0].messageId).toBe("4887");
    }
  });
  it("LF-only and CR-only files parse like CRLF", async () => {
    const lf = await up(csvBytes([validRow(11), validRow(12)], HEADER, "\n"), { filename: "lf.csv" });
    expect(lf.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, lf.body.batchId)).body.counts.accepted).toBe(2);
    const cr = await up(csvBytes([validRow(13), validRow(14)], HEADER, "\r"), { filename: "cr.csv" });
    expect(cr.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, cr.body.batchId)).body.counts.accepted).toBe(2);
  });
  it("SIN column with 9 non-numeric characters -> I8 (param SIN), raw value never echoed in the API", async () => {
    const r = await up(csvBytes([validRow(15, { SIN: "ABCDEFGHI" })]), { filename: "sinalpha.csv" });
    expect(r.body.status).toBe("VALIDATED");
    const f = await api.findings(ADMIN, r.body.batchId);
    expect(f.body.items.map((x: { messageId: string }) => x.messageId)).toEqual(["5131"]);
    expect(f.text).not.toContain("ABCDEFGHI");
    const rec = await api.records(ADMIN, r.body.batchId);
    expect(rec.text).not.toContain("ABCDEFGHI");
  });
  it("quoted fields with embedded commas survive to the Rejected Individuals CSV unchanged", async () => {
    const r = await up(Buffer.from(`${HEADER}\r\n${Object.values(validRow(16, { LastName: `"ABLE, JR"`, Weeks_CurrentYear: "-1" })).join(",")}\r\n`), { filename: "quoted.csv" });
    expect(r.body.status).toBe("VALIDATED");
    const csv = await api.rejectedCsv(ADMIN, r.body.batchId);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[1]).toContain(`"ABLE, JR"`);
  });
});

describe("QA/upload: filenames, fields and formula injection", () => {
  it("path-traversal and very long filenames are stored verbatim as metadata and never reach the lake path", async () => {
    const names = ["..\\..\\..\\windows\\x.csv", "../../etc/passwd.csv", "a".repeat(1000) + ".csv", "spaces and (parens) & stuff.csv", "C:\\Users\\x\\y.csv"];
    let i = 100;
    for (const name of names) {
      const r = await up(csvBytes([validRow(i++)]), { filename: name });
      expect(r.status, name).toBe(200);
      const [raw] = await t.ctx.db.select().from(rawFiles).where(eq(rawFiles.originalFilename, name));
      expect(raw, name).toBeTruthy();
      expect(raw.lakePath).not.toMatch(/\.\.|\\|:/);
      expect(raw.lakePath).toMatch(/^raw\/employer=0235\/filetype=events\/ingest_date=\d{4}-\d{2}-\d{2}\/batch=[0-9a-f-]{36}\/original\.csv$/);
      expect((await api.getBatch(ADMIN, r.body.batchId)).body.originalFilename).toBe(name);
    }
  });
  it("employerId is validated (regex) and Submitters are pinned to their own employer", async () => {
    expectErrorEnvelope(await up(csvBytes([validRow(1)]), { fields: { employerId: "0235; DROP TABLE batches" } }), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await up(csvBytes([validRow(1)]), { fields: { employerId: "" } }), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await up(csvBytes([validRow(1)]), { fields: {} }), 400, "VALIDATION_ERROR");
    const sub = await up(csvBytes([validRow(120)]), { headers: SUB_0235, fields: {} });
    expect(sub.status).toBe(200);
    expect((await api.getBatch(SUB_0235, sub.body.batchId)).body.employerId).toBe("0235");
  });
  it("unknown sourceSystem -> 400; valid one is stored", async () => {
    expectErrorEnvelope(await up(csvBytes([validRow(1)]), { fields: { ...F, sourceSystem: "SAP" } }), 400, "VALIDATION_ERROR");
    const r = await up(csvBytes([validRow(121)]), { fields: { ...F, sourceSystem: "WORKDAY" } });
    expect((await api.getBatch(ADMIN, r.body.batchId)).body.sourceSystem).toBe("WORKDAY");
  });
  it("BUG-API-1 (fixed): executionDate must be a real calendar date; impossible dates are 400", async () => {
    for (const bad of ["2026-13-45", "2026-02-30", "2025-02-29", "2026-00-10", "2026-04-31"]) {
      expectErrorEnvelope(await up(csvBytes([validRow(122)]), { fields: { employerId: "0235", executionDate: bad } }), 400, "VALIDATION_ERROR");
    }
    const ok = await up(csvBytes([validRow(123)]), { fields: { employerId: "0235", executionDate: "2024-02-29" } });
    expect(ok.status).toBe(200);
    expect((await api.getBatch(ADMIN, ok.body.batchId)).body.executionDate).toBe("2024-02-29");
  });
  it("CSV formula injection in name cells is neutralised in the Rejected Individuals CSV and stays inert JSON in the API", async () => {
    const payloads: Array<[string, boolean]> = [
      ["=HYPERLINK(\"http://evil\",\"x\")", true],
      ["+cmd|' /C calc'!A0", true],
      ["@SUM(1+1)", true],
      ["-2+3+cmd", true],
      ["\tTAB", true],
      ["-1", false],
      ["-1.50", false],
      ["Normal Name", false],
    ];
    const rows = payloads.map(([p], i) => validRow(200 + i, { LastName: p, FirstName: p, Weeks_CurrentYear: "-1" }));
    const r = await up(csvBytes(rows), { filename: "formula.csv" });
    expect(r.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, r.body.batchId)).body.counts.rejected).toBe(rows.length);
    const csv = await api.rejectedCsv(ADMIN, r.body.batchId);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = csv.text.replace(/\r\n$/, "").split("\r\n").slice(1);
    expect(lines).toHaveLength(rows.length);
    lines.forEach((line, i) => {
      const [, lastName] = line.split(",");
      const [payload, mustNeutralise] = payloads[i];
      const cell = lastName.startsWith(`"`) ? lastName : lastName;
      if (mustNeutralise) expect(cell.replace(/^"/, "").startsWith("'") || cell.startsWith("'"), `cell ${JSON.stringify(cell)} for ${payload}`).toBe(true);
      else expect(cell.startsWith("'"), `numeric/plain ${payload} must stay reloadable`).toBe(false);
    });
    // No dangerous leading char reaches a cell start anywhere in the output.
    for (const line of lines) for (const cell of line.split(",")) expect(cell.replace(/^"/, "")).not.toMatch(/^[=@\t]/);
    const rec = await api.records(ADMIN, r.body.batchId);
    expect(rec.headers.get("content-type")).toContain("application/json");
    expect(rec.text).toContain("HYPERLINK");
  });
});

describe("QA/upload: configurable limits (separate small-limit context)", () => {
  it("MAX_UPLOAD_ROWS / MAX_LINE_LENGTH / MAX_UPLOAD_BYTES are enforced with 413 envelopes", async () => {
    const small = await createTestContext({ env: { MAX_UPLOAD_ROWS: "10", MAX_LINE_LENGTH: "400", MAX_UPLOAD_BYTES: "4000" } });
    try {
      expectErrorEnvelope(await upload(csvBytes(manyRows(20)), ADMIN, F), 413, "TOO_MANY_ROWS");
      expectErrorEnvelope(await upload(Buffer.from(`${HEADER}\r\n${"x".repeat(401)}\r\n`), ADMIN, F), 413, "LINE_TOO_LONG");
      expectErrorEnvelope(await upload(Buffer.alloc(4001, 0x41), ADMIN, F), 413, "PAYLOAD_TOO_LARGE");
      expect((await upload(csvBytes(manyRows(10)), ADMIN, F)).status).toBe(200);
    } finally {
      await small.cleanup();
      const { setAppContextForTests } = await import("@/lib/app-context");
      setAppContextForTests(t.ctx);
    }
  });
});

describe("QA/state-machine", () => {
  it("TRANSITIONS equals the section 10.1 diagram exactly (no extra edges, none missing)", () => {
    const expected: Record<BatchStatus, BatchStatus[]> = {
      RECEIVED: ["PARSED", "FILE_REJECTED", "FAILED"],
      PARSED: ["VALIDATED", "FAILED"],
      VALIDATED: ["VALIDATED", "LEDGERED", "FAILED"],
      LEDGERED: ["PROJECTION_BUILT", "FAILED"],
      PROJECTION_BUILT: ["PENDING_APPROVAL", "FAILED"],
      PENDING_APPROVAL: ["APPROVED", "REJECTED"],
      APPROVED: ["EXPORTED"],
      REJECTED: ["VALIDATED"],
      EXPORTED: [],
      FAILED: ["RECEIVED"],
      FILE_REJECTED: [],
    };
    for (const s of BATCH_STATUSES) expect([...TRANSITIONS[s]].sort(), s).toEqual([...expected[s]].sort());
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...BATCH_STATUSES].sort());
    expect(canTransition("FILE_REJECTED", "RECEIVED")).toBe(false);
    expect(canTransition("EXPORTED", "VALIDATED")).toBe(false);
    expect(canTransition("RECEIVED", "VALIDATED")).toBe(false);
  });
  it("transitionBatch refuses illegal edges and stale from-states, leaving no history row", async () => {
    const r = await up(csvBytes([validRow(300)]), { filename: "sm.csv" });
    const id = r.body.batchId as string;
    const before = (await t.ctx.db.select().from(batchStatusHistory).where(eq(batchStatusHistory.batchId, id))).length;
    await expect(t.ctx.db.transaction((tx) => transitionBatch(tx, { batchId: id, from: "VALIDATED", to: "RECEIVED", actor: "qa", at: new Date().toISOString() }))).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(t.ctx.db.transaction((tx) => transitionBatch(tx, { batchId: id, from: "PARSED", to: "VALIDATED", actor: "qa", at: new Date().toISOString() }))).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(t.ctx.db.transaction((tx) => transitionBatch(tx, { batchId: "00000000-0000-7000-8000-00000000dead", from: "RECEIVED", to: "PARSED", actor: "qa", at: new Date().toISOString() }))).rejects.toThrow(/not found/);
    const after = (await t.ctx.db.select().from(batchStatusHistory).where(eq(batchStatusHistory.batchId, id))).length;
    expect(after).toBe(before);
    expect((await api.getBatch(ADMIN, id)).body.status).toBe("VALIDATED");
  });
  it("runBatch on a non-RECEIVED batch is a no-op (idempotent; no duplicate history/ledger)", async () => {
    const r = await up(csvBytes([validRow(301)]), { filename: "noop.csv" });
    const id = r.body.batchId as string;
    const head = (await api.ledgerHead()).body.seq;
    expect(await runBatch(t.ctx, id)).toBe("VALIDATED");
    expect((await api.ledgerHead()).body.seq).toBe(head);
    expect((await api.getBatch(ADMIN, id)).body.statusHistory).toHaveLength(3);
  });
  it("duplicate content: same employer -> same batchId regardless of filename/uploader; other employer -> new batch; FILE_REJECTED never dedups", async () => {
    const bytes = csvBytes([validRow(302)]);
    const a = await up(bytes, { filename: "first.csv" });
    const b = await up(bytes, { filename: "second-name.csv", headers: SUB_0235, fields: {} });
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ batchId: a.body.batchId, duplicate: true, sha256: a.body.sha256 });
    const c = await up(bytes, { filename: "first.csv", fields: { employerId: "0359" } });
    expect(c.body.duplicate).toBe(false);
    expect(c.body.batchId).not.toBe(a.body.batchId);
    const bad = goldenInput("file-rejected-header");
    const r1 = await up(bad, { filename: "bad1.csv" });
    const r2 = await up(bad, { filename: "bad2.csv" });
    expect(r1.body.status).toBe("FILE_REJECTED");
    expect(r2.body.duplicate).toBe(false);
    expect(r2.body.batchId).not.toBe(r1.body.batchId);
    const all = await t.ctx.db.select().from(batches).where(eq(batches.fileSha256, a.body.sha256));
    expect(all.map((x) => x.employerId).sort()).toEqual(["0235", "0359"]);
  });
  it("a duplicate upload appends BatchReceived{duplicateOf} to the EXISTING batch stream and nothing else", async () => {
    const bytes = csvBytes([validRow(303)]);
    const a = await up(bytes, { filename: "dup-a.csv" });
    const before = (await t.ctx.ledger.list({ batchId: a.body.batchId, limit: 200 })).items.length;
    await up(bytes, { filename: "dup-b.csv" });
    const after = await t.ctx.ledger.list({ batchId: a.body.batchId, limit: 200, order: "asc" });
    expect(after.items).toHaveLength(before + 1);
    expect(after.items[after.items.length - 1]).toMatchObject({ eventType: "BatchReceived", payload: { duplicateOf: a.body.batchId, originalFilename: "dup-b.csv" } });
  });
  it("ingest() with an explicit executionDate is honoured and a pipeline failure lands in FAILED with a reason (not a crash)", async () => {
    const r = await ingest(t.ctx, { bytes: csvBytes([validRow(304)]), filename: "fail.csv", employerId: "0235", submittedBy: "user:qa", executionDate: "2026-10-08" });
    if (r.duplicate) throw new Error("unexpected duplicate");
    // Corrupt the raw file in the lake so the sha256 integrity check trips inside runBatch.
    const [raw] = await t.ctx.db.select().from(rawFiles).where(eq(rawFiles.sha256, r.sha256));
    await writeFile(path.join(t.lakeRoot, ...raw.lakePath.split("/")), Buffer.from("tampered"));
    expect(await runBatch(t.ctx, r.batchId)).toBe("FAILED");
    const b = await api.getBatch(ADMIN, r.batchId);
    expect(b.body.status).toBe("FAILED");
    expect(b.body.failureReason).toMatch(/sha256 mismatch/);
    expect(b.body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RECEIVED", "FAILED"]);
    expect(await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, r.batchId))).toHaveLength(0);
    created.push(r.batchId);
  });
  it("every batch created by this suite ended in a legal state via legal transitions", async () => {
    expect(created.length).toBeGreaterThan(20);
    const seen = new Set<string>();
    for (const id of [...new Set(created)]) seen.add((await expectLegalBatchState(t, id)).status);
    expect([...seen].sort()).toEqual(["FAILED", "FILE_REJECTED", "VALIDATED"]);
  });
  it("the whole ledger still verifies after every adversarial upload", async () => {
    const v = await t.ctx.ledger.verify();
    expect(v.ok, v.reason).toBe(true);
  });
});
