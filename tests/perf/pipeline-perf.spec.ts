import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingest } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/run";
import { csvBytes, manyRows, validRow, type Row } from "../helpers/qa-api";
import { createTestContext, type TestContext } from "../helpers/test-context";

/**
 * Opt-in performance smoke (architecture section 15): `npm run test:perf`.
 * Budgets are generous on purpose; the numbers are what matter and are printed for the QA report.
 */

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.cleanup());

function mixedRows(n: number, salt: number): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const k = i % 10;
    const over: Row = k === 0 ? { Weeks_CurrentYear: "-1" } : k === 1 ? { EventType: "RETIRE" } : k === 2 ? { EmploymentEndDate: "13992026" } : k === 3 ? { PA_CurrentYear: "1.5", Weeks_CurrentYear: "12.345" } : {};
    return validRow(i + 1 + salt, over);
  });
}

async function run(label: string, rows: Row[], employerId: string) {
  const bytes = csvBytes(rows);
  if (global.gc) global.gc();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const r = await ingest(t.ctx, { bytes, filename: `${label}.csv`, employerId, submittedBy: "user:perf", executionDate: "2026-10-08" });
  if (r.duplicate) throw new Error("dup");
  const t1 = performance.now();
  const status = await runBatch(t.ctx, r.batchId);
  const t2 = performance.now();
  const heap1 = process.memoryUsage().heapUsed;
  const head = await t.ctx.ledger.head();
  const line = `[perf] ${label}: rows=${rows.length} bytes=${bytes.length} ingest=${Math.round(t1 - t0)}ms run=${Math.round(t2 - t1)}ms total=${Math.round(t2 - t0)}ms heapDelta=${Math.round((heap1 - heap0) / 1024 / 1024)}MB rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB ledgerHead=${head.seq} status=${status}`;
  console.info(line);
  return { status, total: t2 - t0, run: t2 - t1 };
}

describe("perf: time to VALIDATED", () => {
  it("100 clean rows", async () => {
    const r = await run("clean-100", manyRows(100, 100_000), "0235");
    expect(r.status).toBe("VALIDATED");
    expect(r.total).toBeLessThan(10_000);
  });
  it("1,000 clean rows", async () => {
    const r = await run("clean-1000", manyRows(1000, 200_000), "0235");
    expect(r.status).toBe("VALIDATED");
    expect(r.total).toBeLessThan(30_000);
  });
  it("5,000 clean rows (section 15 budget: validate < 60 s)", async () => {
    const r = await run("clean-5000", manyRows(5000, 300_000), "0235");
    expect(r.status).toBe("VALIDATED");
    expect(r.total).toBeLessThan(60_000);
  });
  it("5,000 mixed rows (40 % rejected => ~2,000 MemberRecordRejected ledger entries)", async () => {
    const r = await run("mixed-5000", mixedRows(5000, 400_000), "0359");
    expect(r.status).toBe("VALIDATED");
    expect(r.total).toBeLessThan(120_000);
  });
  it("the ledger still verifies after the perf runs and verify() itself is timed", async () => {
    const t0 = performance.now();
    const v = await t.ctx.ledger.verify();
    console.info(`[perf] verify(${v.checked} entries): ${Math.round(performance.now() - t0)} ms`);
    expect(v.ok).toBe(true);
  });
});
