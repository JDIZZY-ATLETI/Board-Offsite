import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parseArielSeed } from "@/lib/ariel/seed";
import { validationFindings } from "@/lib/db/schema";
import { withLuhnCheckDigit } from "@/lib/pii/sin";
import { ingest } from "@/lib/pipeline/ingest";
import { revalidateOffline } from "@/lib/pipeline/revalidate";
import { runBatch } from "@/lib/pipeline/run";
import { contribsFor, mdcYear, paFor } from "../helpers/ariel-fixtures";
import { goldenInput } from "../helpers/fixtures";
import { csvBytes, type Row } from "../helpers/qa-api";
import { createTestContext, fixtureSeed, type TestContext } from "../helpers/test-context";

/** Phase 2 perf smoke: every row matches a seeded member so the full L1 + provisional derivation + 41 L2 rules + snapshot path runs. */

const N = 1000;
let t: TestContext;

function perfSeed() {
  const base = fixtureSeed();
  const members: unknown[] = [];
  for (let i = 0; i < N; i++) {
    const a = mdcYear(2024, 72000);
    const b = mdcYear(2025, 75000);
    members.push({
      key: `P${i}`,
      scenario: "perf",
      sin: withLuhnCheckDigit(String(95000000 + i)),
      lastName: `PERF${i}`,
      firstName: "Pat",
      dateOfBirth: "1985-04-12",
      statusEffectiveDate: "2015-03-02",
      statusHistory: [{ status: "A", effectiveDate: "2015-03-02" }],
      addresses: [{ effectiveStartDate: "2015-03-02" }],
      employments: [{ employerId: "0235", permanencyDate: "2015-03-02", lastAnnualDataUpdate: "2025-12-31", service: [a.service, b.service], contributions: [a.low, a.high, b.low, b.high] }],
    });
  }
  return parseArielSeed({ ...base, members: [...base.members, ...members] });
}

function perfRows(): Row[] {
  const c = contribsFor(2026, 78000, 38);
  const pa = paFor(2026, 78000, 38);
  return Array.from({ length: N }, (_, i) => ({
    SIN: withLuhnCheckDigit(String(95000000 + i)), LastName: `PERF${i}`, FirstName: "Pat", EventType: "TERFIN", EmploymentEndDate: "09302026",
    Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: c.low, HighContributions_CurrentYear: c.high, AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: pa,
    Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "",
  }));
}

async function run(label: string, bytes: Buffer) {
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const r = await ingest(t.ctx, { bytes, filename: `${label}.csv`, employerId: "0235", submittedBy: "user:perf", executionDate: "2026-10-08" });
  const t1 = performance.now();
  const status = await runBatch(t.ctx, r.batchId);
  const t2 = performance.now();
  const findings = (await t.ctx.db.select({ id: validationFindings.findingId }).from(validationFindings).where(eq(validationFindings.batchId, r.batchId))).length;
  const t3 = performance.now();
  const re = await revalidateOffline(t.ctx, r.batchId);
  const t4 = performance.now();
  const head = await t.ctx.ledger.head();
  const line = `[perf-p2] ${label}: bytes=${bytes.length} ingest=${Math.round(t1 - t0)}ms run(parse+L1+L2+snapshot+ledger)=${Math.round(t2 - t1)}ms total=${Math.round(t2 - t0)}ms offlineRevalidate=${Math.round(t4 - t3)}ms findings=${findings} accepted=${re.counts.accepted} rejected=${re.counts.rejected} held=${re.counts.held} heapDelta=${Math.round((process.memoryUsage().heapUsed - heap0) / 1024 / 1024)}MB rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB ledgerHead=${head.seq} status=${status}`;
  console.log(line);
  return { status, totalMs: t2 - t0, counts: re.counts, findings };
}

beforeAll(async () => {
  t = await createTestContext({ seed: perfSeed() });
});
afterAll(() => t.cleanup());

describe("perf (Phase 2): L1 + L2 + Ariel snapshot to VALIDATED", () => {
  it("golden mixed-100-rows", async () => {
    const r = await run("mixed-100", goldenInput("mixed-100-rows"));
    expect(r.status).toBe("VALIDATED");
    expect(r.counts).toEqual({ accepted: 19, rejected: 73, held: 8, findings: 116 });
  });
  it("1,000 rows, every SIN a seeded member with 2024/2025 MDC history (full L2 path)", async () => {
    const r = await run("l2-1000", csvBytes(perfRows()));
    expect(r.status).toBe("VALIDATED");
    expect(r.counts.accepted).toBe(N);
    expect(r.findings).toBe(0);
    expect(r.totalMs).toBeLessThan(60_000);
  });
  it("the ledger still verifies", async () => {
    const t0 = performance.now();
    const v = await t.ctx.ledger.verify();
    console.log(`[perf-p2] verify: ok=${v.ok} checked=${v.checked} ${Math.round(performance.now() - t0)}ms`);
    expect(v.ok).toBe(true);
  });
});
