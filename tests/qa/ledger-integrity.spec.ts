import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZERO64 } from "@/lib/crypto/hash";
import { GLOBAL_STREAM, ledgerEntries, ledgerHeads } from "@/lib/db/schema";
import { recomputeHashes, rowToEntry } from "@/lib/ledger/service";
import { ingest } from "@/lib/pipeline/ingest";
import { runBatch } from "@/lib/pipeline/run";
import { ADMIN, api, csvBytes, expectErrorEnvelope, manyRows, validRow } from "../helpers/qa-api";
import { createTestContext, type TestContext } from "../helpers/test-context";

/** QA plan item 5: ledger integrity under concurrency, odd verify ranges, transactional append, trigger guards. */

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.cleanup());

/** Drizzle wraps PG errors; match on the message or the cause. */
async function rejectsWith(p: Promise<unknown>, re: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected rejection").not.toBeNull();
  const e = caught as Error & { cause?: Error };
  expect(`${e.message} ${e.cause?.message ?? ""}`).toMatch(re);
}

/** Independent re-implementation of the chain walk (does not reuse LedgerService.verify). */
async function auditChain() {
  const rows = await t.ctx.db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  const entries = rows.map(rowToEntry);
  let prevGlobal = ZERO64;
  const streams = new Map<string, { seq: number; hash: string }>();
  entries.forEach((e, i) => {
    expect(e.seq, "global seq gapless").toBe(i + 1);
    expect(e.prevHashGlobal, `prevHashGlobal at seq ${e.seq}`).toBe(prevGlobal);
    const st = streams.get(e.streamId) ?? { seq: 0, hash: ZERO64 };
    expect(e.streamSeq, `streamSeq in ${e.streamId} at seq ${e.seq}`).toBe(st.seq + 1);
    expect(e.prevHashStream, `prevHashStream in ${e.streamId} at seq ${e.seq}`).toBe(st.hash);
    const r = recomputeHashes(e);
    expect(r.matches, `hashes at seq ${e.seq}`).toBe(true);
    expect(e.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    streams.set(e.streamId, { seq: e.streamSeq, hash: e.entryHash });
    prevGlobal = e.entryHash;
  });
  const heads = await t.ctx.db.select().from(ledgerHeads);
  const g = heads.find((h) => h.streamId === GLOBAL_STREAM)!;
  expect(Number(g.lastSeq)).toBe(entries.length);
  expect(g.lastHash).toBe(prevGlobal);
  for (const [streamId, st] of streams) {
    const h = heads.find((x) => x.streamId === streamId);
    expect(h, `head row for ${streamId}`).toBeTruthy();
    expect(Number(h!.lastSeq)).toBe(st.seq);
    expect(h!.lastHash).toBe(st.hash);
  }
  expect(heads.length).toBe(streams.size + 1);
  return entries;
}

describe("QA/ledger: concurrency", () => {
  it("5 parallel uploads (distinct employers + content) leave a gapless, fully chained ledger that verifies", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => async () => {
      const r = await ingest(t.ctx, { bytes: csvBytes(manyRows(20, i * 100)), filename: `par-${i}.csv`, employerId: `0${235 + i}`, submittedBy: `user:qa${i}`, executionDate: "2026-10-08" });
      if (r.duplicate) throw new Error("unexpected duplicate");
      return runBatch(t.ctx, r.batchId);
    });
    const statuses = await Promise.all(jobs.map((j) => j()));
    expect(statuses).toEqual(["PENDING_APPROVAL", "PENDING_APPROVAL", "PENDING_APPROVAL", "PENDING_APPROVAL", "PENDING_APPROVAL"]);
    const entries = await auditChain();
    // 2 batch entries + one member outcome per row (unknown SINs are rejected by B2) + an (empty) UpdateSetBuilt per upload.
    expect(entries.length).toBe(5 * (2 + 20 + 1));
    const v = await t.ctx.ledger.verify();
    expect(v).toMatchObject({ ok: true, checked: 115, headSeq: 115 });
  });
  it("parallel uploads of identical bytes for one employer: exactly one batch, the rest are duplicates (unique index race)", async () => {
    const bytes = csvBytes([validRow(999)]);
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => ingest(t.ctx, { bytes, filename: `race-${i}.csv`, employerId: "0235", submittedBy: "user:qa", executionDate: "2026-10-08" })));
    const ids = new Set(results.map((r) => r.batchId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    await auditChain();
  });
  it("member streams: rejected rows with the same SIN across batches chain on one member stream", async () => {
    const bad = (salt: number) => csvBytes([validRow(500, { Weeks_CurrentYear: "-1", LastName: `S${salt}` })]);
    for (const s of [1, 2]) {
      const r = await ingest(t.ctx, { bytes: bad(s), filename: `m${s}.csv`, employerId: "0235", submittedBy: "user:qa", executionDate: "2026-10-08" });
      if (!r.duplicate) await runBatch(t.ctx, r.batchId);
    }
    const member = (await t.ctx.ledger.list({ streamKind: "member", eventType: "MemberRecordRejected", order: "asc", limit: 200 })).items;
    const mine = member.filter((e) => (e.payload as { sinMasked: string }).sinMasked === "***-***-500");
    expect(mine).toHaveLength(2);
    expect(mine[0].streamId).toBe(mine[1].streamId);
    expect(mine.map((e) => e.streamSeq)).toEqual([1, 2]);
    expect(mine[1].prevHashStream).toBe(mine[0].entryHash);
    expect(mine[0].streamId).toMatch(/^member:[0-9a-f]{64}$/);
    await auditChain();
  });
});

describe("QA/ledger: verify() parameter edge cases", () => {
  it("empty range, reversed range and out-of-range are handled without throwing (behaviour documented)", async () => {
    const head = (await t.ctx.ledger.head()).seq;
    expect(head).toBeGreaterThan(5);
    const empty = await t.ctx.ledger.verify({ fromSeq: head + 1, toSeq: head + 1 });
    expect(empty).toMatchObject({ ok: true, checked: 0 });
    const reversed = await t.ctx.ledger.verify({ fromSeq: 5, toSeq: 2 });
    expect(reversed).toMatchObject({ ok: true, checked: 0 });
    const beyond = await t.ctx.ledger.verify({ toSeq: head + 1000 });
    expect(beyond).toMatchObject({ ok: true, checked: head });
    const noPredecessor = await t.ctx.ledger.verify({ fromSeq: head + 5 });
    expect(noPredecessor).toMatchObject({ ok: false, firstBadSeq: head + 4, reason: "missing predecessor entry" });
    const unknownStream = await t.ctx.ledger.verify({ streamId: "member:nope" });
    expect(unknownStream).toMatchObject({ ok: true, checked: 0 });
  });
  it("GAP-LEDGER-1 (fixed): a reversed range is 400 at the API; a range that checks nothing is ok:true/checked:0 but is NOT ledgered", async () => {
    expectErrorEnvelope(await api.verify(ADMIN, JSON.stringify({ fromSeq: 5, toSeq: 2 })), 400, "VALIDATION_ERROR");
    const head = (await t.ctx.ledger.head()).seq;
    const before = (await t.ctx.ledger.list({ streamId: "system", eventType: "ChainAnchorPublished", limit: 200 })).items.length;
    for (const body of [{ fromSeq: head + 1, toSeq: head + 1 }, { streamId: "member:nope" }]) {
      const r = await api.verify(ADMIN, JSON.stringify(body));
      expect(r.status, JSON.stringify(body)).toBe(200);
      expect(r.body).toMatchObject({ ok: true, checked: 0, ledgerSeq: null });
    }
    expect((await t.ctx.ledger.head()).seq).toBe(head);
    expect((await t.ctx.ledger.list({ streamId: "system", eventType: "ChainAnchorPublished", limit: 200 })).items.length).toBe(before);
    // A real verification is still ledgered.
    const real = await api.verify(ADMIN, JSON.stringify({ fromSeq: 1, toSeq: 2 }));
    expect(real.body).toMatchObject({ ok: true, checked: 2, ledgerSeq: head + 1 });
  });
  it("API: fromSeq/toSeq must be positive integers; streamId length is capped", async () => {
    expectErrorEnvelope(await api.verify(ADMIN, JSON.stringify({ fromSeq: -1 })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.verify(ADMIN, JSON.stringify({ toSeq: 1.5 })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.verify(ADMIN, JSON.stringify({ streamId: "x".repeat(201) })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.verify(ADMIN, "[]"), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.verify(ADMIN, "null"), 400, "VALIDATION_ERROR");
  });
  it("every verify call is itself ledgered on the system stream and the chain still verifies", async () => {
    const before = (await t.ctx.ledger.head()).seq;
    const r = await api.verify(ADMIN, "{}");
    expect(r.status).toBe(200);
    expect(r.body.ledgerSeq).toBe(before + 1);
    const e = await t.ctx.ledger.getBySeq(before + 1);
    expect(e).toMatchObject({ streamId: "system", eventType: "ChainAnchorPublished", actor: "user:qa-admin" });
    await auditChain();
  });
});

describe("QA/ledger: atomicity and immutability", () => {
  it("appendMany inside a failing transaction leaves no entries and does not move the heads", async () => {
    const before = await t.ctx.ledger.head();
    const count = (await t.ctx.db.select().from(ledgerEntries)).length;
    await expect(
      t.ctx.db.transaction(async (tx) => {
        await t.ctx.ledger.appendMany(
          [
            { streamId: "batch:qa-atomic", eventType: "BatchReceived", batchId: null, actor: "user:qa", payload: { n: 1 } },
            { streamId: "batch:qa-atomic", eventType: "BatchParsed", batchId: null, actor: "user:qa", payload: { n: 2 } },
          ],
          tx,
        );
        throw new Error("simulated mid-pipeline failure");
      }),
    ).rejects.toThrow(/simulated/);
    expect(await t.ctx.ledger.head()).toEqual(before);
    expect((await t.ctx.db.select().from(ledgerEntries)).length).toBe(count);
    expect((await t.ctx.db.select().from(ledgerHeads)).some((h) => h.streamId === "batch:qa-atomic")).toBe(false);
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
  });
  it("a chunk of 600 drafts appends atomically with correct intra-chunk stream chaining", async () => {
    const drafts = Array.from({ length: 600 }, (_, i) => ({ streamId: `member:qa${i % 7}`, eventType: "MemberRecordRejected" as const, batchId: null, actor: "user:qa", payload: { i } }));
    const t0 = Date.now();
    const out = await t.ctx.ledger.appendMany(drafts);
    const ms = Date.now() - t0;
    console.info(`[perf] appendMany(600) in one tx: ${ms} ms (${Math.round((600 / ms) * 1000)} entries/s)`);
    expect(out).toHaveLength(600);
    expect(out.map((e) => e.seq)).toEqual(Array.from({ length: 600 }, (_, i) => out[0].seq + i));
    await auditChain();
  });
  it("UPDATE / DELETE / TRUNCATE on ledger_entries and tampering with ledger_heads are blocked", async () => {
    await rejectsWith(t.ctx.db.execute(sql`UPDATE ledger_entries SET payload = '{}'::jsonb WHERE seq = 1`), /append-only/);
    await rejectsWith(t.ctx.db.execute(sql`DELETE FROM ledger_entries WHERE seq = (SELECT max(seq) FROM ledger_entries)`), /append-only/);
    await rejectsWith(t.ctx.db.execute(sql`TRUNCATE ledger_entries`), /append-only|truncate/i);
    // An insert that skips a seq or forges the previous hash is refused by the chain trigger.
    const head = await t.ctx.ledger.head();
    await rejectsWith(
      t.ctx.db.execute(sql`INSERT INTO ledger_entries (seq, entry_id, stream_id, stream_seq, event_type, batch_id, actor, occurred_at, payload, payload_hash, prev_hash_global, prev_hash_stream, entry_hash) VALUES (${head.seq + 2}, '00000000-0000-7000-8000-0000000000aa', 'system', 999, 'ChainAnchorPublished', NULL, 'evil', now(), '{}'::jsonb, ${ZERO64}, ${head.hash}, ${ZERO64}, ${"a".repeat(64)})`),
      /chain mismatch|global/i,
    );
    expect(await t.ctx.ledger.head()).toEqual(head);
  });
  it("verify() detects a deleted tail (trigger disabled by a superuser) via the heads check", async () => {
    const head = await t.ctx.ledger.head();
    await t.ctx.db.execute(sql`ALTER TABLE ledger_entries DISABLE TRIGGER trg_ledger_no_update`);
    try {
      await t.ctx.db.execute(sql`DELETE FROM ledger_entries WHERE seq = ${head.seq}`);
      const v = await t.ctx.ledger.verify();
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/ledger_heads does not match|count/);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE ledger_entries ENABLE TRIGGER trg_ledger_no_update`);
    }
  });
});
