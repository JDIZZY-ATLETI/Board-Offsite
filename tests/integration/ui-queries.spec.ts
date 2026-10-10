import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingest } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/run";
import { findingsByRule, getDashboardData } from "@/lib/queries/dashboard";
import { overrideFinding } from "@/lib/pipeline/override";
import { validationFindings } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
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
    expect(r.parsed.currentYear.weeks).toBe("5.00");
    expect(r.rawValues.Weeks_CurrentYear).toBe("5.00");
    expect(r.parsed.employmentEndDate).toBe("2026-02-11");
    expect(r.outcome).toBe("ACCEPTED");
    const held = await listRecords(t.ctx, mixedId, { accepted: "held", limit: 50 });
    expect(held.items.length).toBe(8);
    expect(held.items.every((x) => x.outcome === "HELD" && x.findingCounts.warning > 0 && x.findingCounts.cme === 0)).toBe(true);
    expect(r.sinPseudo).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recordOutcomeCounts matches the batch counters", async () => {
    const c = await recordOutcomeCounts(t.ctx, mixedId);
    expect(c.accepted).toBe(19);
    expect(c.rejected).toBe(73);
    expect(c.held).toBe(8);
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
    expect(all.kpis.rejectedRows30d).toBe(73);
    expect(all.kpis.rejectionRate30d).toBeCloseTo(0.73, 5);
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
    // 73 rejected + 19 accepted rows are ledgered; the blank-SIN row lands on the batch stream; HELD rows wait for their override.
    expect(memberOnly.items.length).toBe(91);
    expect(memberOnly.items.every((e) => e.streamId.startsWith("member:"))).toBe(true);
    expect(system.items.length).toBe(1);
    expect(system.items[0].eventType).toBe("ChainAnchorPublished");
  });

  it("findingsByRule (ux 5.1 item 15): PRIVATE only when included, employer scope, limit, 30-day window, overridden count", async () => {
    const pub = await findingsByRule(t.ctx, { includePrivate: false });
    const all = await findingsByRule(t.ctx, { includePrivate: true });
    expect(pub.items.length).toBeGreaterThan(0);
    expect(pub.items.length).toBeLessThanOrEqual(8);
    expect(pub.items.every((r) => r.severity !== "INFORMATION")).toBe(true);
    expect(all.totalFindings).toBeGreaterThan(pub.totalFindings);
    expect(all.items.length).toBe(8);
    // Ordered by finding count, then rule id; counts are consistent.
    for (let i = 1; i < all.items.length; i += 1) expect(all.items[i - 1].findings).toBeGreaterThanOrEqual(all.items[i].findings);
    for (const r of all.items) {
      expect(r.rows).toBeLessThanOrEqual(r.findings);
      expect(r.batches).toBe(1);
      expect(r.overridden).toBe(0);
    }
    // File-level findings (FILE_ERROR on the rejected-header batch) have no record and are excluded; only the mixed batch counts.
    expect(all.batches).toBe(1);
    expect(all.items.some((r) => r.severity === "FILE_ERROR")).toBe(false);
    // Submitter scope: another employer sees nothing; the owning employer sees PUBLIC only.
    const other = await findingsByRule(t.ctx, { includePrivate: false, scopeEmployerId: "0359" });
    expect(other.items).toEqual([]);
    expect(other.totalFindings).toBe(0);
    const own = await findingsByRule(t.ctx, { includePrivate: false, scopeEmployerId: "0235" });
    expect(own.totalFindings).toBe(pub.totalFindings);
    // Limit.
    const top3 = await findingsByRule(t.ctx, { includePrivate: true, limit: 3 });
    expect(top3.items.map((r) => r.ruleId)).toEqual(all.items.slice(0, 3).map((r) => r.ruleId));
    expect(top3.totalFindings).toBe(all.totalFindings);
    // Window: a clock 31 days ahead sees nothing; 60 days with a wide window sees everything again.
    const later = { ...t.ctx, clock: () => new Date(t.ctx.clock().getTime() + 31 * 86_400_000) };
    const stale = await findingsByRule(later, { includePrivate: true });
    expect(stale.items).toEqual([]);
    expect(stale.batches).toBe(0);
    const wide = await findingsByRule(later, { includePrivate: true, days: 60 });
    expect(wide.totalFindings).toBe(all.totalFindings);
    // Overridden column follows a recorded override on a HELD-row B40 warning.
    const held = await listRecords(t.ctx, mixedId, { accepted: "held", limit: 50 });
    const heldLines = new Set(held.items.map((r) => r.lineNumber));
    const b40s = await t.ctx.db
      .select()
      .from(validationFindings)
      .where(and(eq(validationFindings.batchId, mixedId), eq(validationFindings.ruleId, "B40")));
    const w = b40s.find((f) => heldLines.has(f.lineNumber ?? -1));
    expect(w).toBeDefined();
    await overrideFinding(t.ctx, { userId: "qa-rev", role: "Reviewer", employerId: null, actor: "user:qa-rev" }, w!.findingId, { reason: w!.overrideReasons[0] });
    const after = await findingsByRule(t.ctx, { includePrivate: true, limit: 100 });
    expect(after.items.find((r) => r.ruleId === "B40")?.overridden).toBe(1);
    expect(after.items.filter((r) => r.ruleId !== "B40").every((r) => r.overridden === 0)).toBe(true);
    expect(after.totalFindings).toBe(all.totalFindings);
  });
});