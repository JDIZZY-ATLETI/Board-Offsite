import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingest } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/run";
import { getDashboardData } from "@/lib/queries/dashboard";
import { findingFacets, listFindings } from "@/lib/queries/findings";
import { getLastVerification, listLedgerEntries, verifyLedger } from "@/lib/queries/ledger";
import { listRecords, recordOutcomeCounts, recordsByLineNumbers } from "@/lib/queries/records";
import { goldenInput } from "../helpers/fixtures";
import { createTestContext, type TestContext } from "../helpers/test-context";

let t: TestContext;
let mixedId: string;
let rejectedId: string;

beforeAll(async () => {
  t = await createTestContext();
  const a = await ingest(t.ctx, { bytes: goldenInput("mixed-100-rows"), filename: "mixed.csv", employerId: "0235", submittedBy: "user:jsmith", executionDate: "2026-10-08" });
  mixedId = a.batchId;
  await runBatch(t.ctx, mixedId);
  const b = await ingest(t.ctx, { bytes: goldenInput("file-rejected-header"), filename: "bad-header.csv", employerId: "0359", submittedBy: "user:mlee", executionDate: "2026-10-08" });
  rejectedId = b.batchId;
  await runBatch(t.ctx, rejectedId);
});
afterAll(() => t.cleanup());

describe("UI query helpers (Phase 1B backend touch-ups)", () => {
  it("findingFacets counts by severity, rule and field and respects PRIVATE visibility", async () => {
    const pub = await findingFacets(t.ctx, mixedId, false);
    const all = await findingFacets(t.ctx, mixedId, true);
    expect(pub.total).toBeGreaterThan(0);
    expect(pub.bySeverity.find((s) => s.value === "COMPLETE_MEMBER_ERROR")?.count).toBeGreaterThan(0);
    expect(pub.byRule.length).toBeGreaterThan(1);
    expect(pub.byField.every((f) => typeof f.value === "string")).toBe(true);
    expect(all.total).toBeGreaterThanOrEqual(pub.total);
    const sum = pub.bySeverity.reduce((s, r) => s + r.count, 0);
    expect(sum).toBe(pub.total);
  });

  it("recordsByLineNumbers returns member facts keyed by line and ignores unknown lines", async () => {
    const page = await listFindings(t.ctx, mixedId, { includePrivate: false, limit: 50 });
    const lines = page.items.map((f) => f.lineNumber ?? 0);
    const recs = await recordsByLineNumbers(t.ctx, mixedId, [...lines, 999_999, 0]);
    for (const l of lines.filter((n) => n > 0)) {
      expect(recs[l], `line ${l}`).toBeDefined();
      // Malformed SINs keep their last 3 raw characters (e.g. "78X"); never more than 3.
      if (recs[l].sinMasked !== null) expect(recs[l].sinMasked).toMatch(/^\*\*\*-\*\*\*-.{1,3}$/);
    }
    expect(recs[999_999]).toBeUndefined();
  });

  it("listRecords exposes parsed values beside raw values", async () => {
    const page = await listRecords(t.ctx, mixedId, { limit: 5 });
    expect(page.items.length).toBe(5);
    const r = page.items[0];
    expect(r.parsed.currentYear.weeks).toBe("21.00");
    expect(r.rawValues.Weeks_CurrentYear).toBe("21.00");
    expect(r.parsed.employmentEndDate).toBe("2026-03-21");
    expect(r.sinPseudo).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recordOutcomeCounts matches the batch counters", async () => {
    const c = await recordOutcomeCounts(t.ctx, mixedId);
    expect(c.accepted).toBe(62);
    expect(c.rejected).toBe(38);
    expect(c.pending).toBe(0);
    expect(c.byEventType.reduce((s, e) => s + e.rows, 0)).toBe(100);
  });

  it("dashboard aggregates respect the employer scope", async () => {
    const all = await getDashboardData(t.ctx, null);
    const scoped = await getDashboardData(t.ctx, "0359");
    expect(all.recent.length).toBe(2);
    expect(scoped.recent.length).toBe(1);
    expect(scoped.recent[0].batchId).toBe(rejectedId);
    expect(all.kpis.rows30d).toBe(100);
    expect(all.kpis.rejectedRows30d).toBe(38);
    expect(all.kpis.rejectionRate30d).toBeCloseTo(0.38, 5);
    expect(all.needsAttention.map((b) => b.batchId)).toEqual([rejectedId]);
    expect(scoped.kpis.rejectionRate30d).toBeNull();
  });

  it("getLastVerification is null until a verify runs, then reflects the anchor entry", async () => {
    expect(await getLastVerification(t.ctx)).toBeNull();
    const v = await verifyLedger(t.ctx, {}, "user:admin");
    expect(v.ok).toBe(true);
    const last = await getLastVerification(t.ctx);
    expect(last).not.toBeNull();
    expect(last!.ok).toBe(true);
    expect(last!.checked).toBe(v.checked);
    expect(last!.ledgerSeq).toBe(v.ledgerSeq);
    expect(last!.durationMs).toBeTypeOf("number");
    expect(last!.partial).toBe(false);
  });

  it("listLedgerEntries filters by stream kind", async () => {
    const batchOnly = await listLedgerEntries(t.ctx, { streamKind: "batch", limit: 200 });
    const memberOnly = await listLedgerEntries(t.ctx, { streamKind: "member", limit: 200 });
    const system = await listLedgerEntries(t.ctx, { streamKind: "system", limit: 200 });
    expect(batchOnly.items.every((e) => e.streamId.startsWith("batch:"))).toBe(true);
    // 38 rejected rows, one of which has a blank SIN and therefore lands on the batch stream.
    expect(memberOnly.items.length).toBe(37);
    expect(memberOnly.items.every((e) => e.streamId.startsWith("member:"))).toBe(true);
    expect(system.items.length).toBe(1);
    expect(system.items[0].eventType).toBe("ChainAnchorPublished");
  });
});