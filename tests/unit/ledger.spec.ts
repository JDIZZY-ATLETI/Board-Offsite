import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerEntries } from "@/lib/db/schema";
import { recomputeHashes } from "@/lib/ledger/service";
import { ZERO64 } from "@/lib/crypto/hash";
import { createTestContext, type TestContext } from "../helpers/test-context";

let t: TestContext;

/** Drizzle wraps driver errors ("Failed query: ...") and keeps the real message in `cause`. */
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

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.cleanup());

describe("LedgerService", () => {
  it("starts at genesis", async () => {
    const head = await t.ctx.ledger.head();
    expect(head).toEqual({ seq: 0, hash: ZERO64, streams: 0 });
    expect(await t.ctx.ledger.verify()).toMatchObject({ ok: true, checked: 0, headSeq: 0 });
  });

  it("appends with global and per-stream chaining", async () => {
    const a = await t.ctx.ledger.append({ streamId: "batch:b1", eventType: "BatchReceived", batchId: null, actor: "user:x", payload: { n: 1 } });
    const b = await t.ctx.ledger.append({ streamId: "member:m1", eventType: "MemberRecordRejected", batchId: null, actor: "system:pipeline", payload: { n: 2 } });
    const c = await t.ctx.ledger.append({ streamId: "batch:b1", eventType: "BatchParsed", batchId: null, actor: "system:pipeline", payload: { n: 3 } });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect([a.streamSeq, b.streamSeq, c.streamSeq]).toEqual([1, 1, 2]);
    expect(a.prevHashGlobal).toBe(ZERO64);
    expect(b.prevHashGlobal).toBe(a.entryHash);
    expect(c.prevHashGlobal).toBe(b.entryHash);
    expect(c.prevHashStream).toBe(a.entryHash);
    expect(b.prevHashStream).toBe(ZERO64);
    expect(recomputeHashes(c).matches).toBe(true);
    const head = await t.ctx.ledger.head();
    expect(head).toEqual({ seq: 3, hash: c.entryHash, streams: 2 });
    expect(a.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("appendMany chains consecutive entries on the same stream inside one transaction", async () => {
    const list = await t.ctx.ledger.appendMany([
      { streamId: "member:m2", eventType: "MemberRecordRejected", batchId: null, actor: "system:pipeline", payload: { i: 1 } },
      { streamId: "member:m2", eventType: "MemberRecordRejected", batchId: null, actor: "system:pipeline", payload: { i: 2 } },
    ]);
    expect(list[1].prevHashStream).toBe(list[0].entryHash);
    expect(list[1].streamSeq).toBe(2);
  });

  it("round-trips entries through the DB and verifies the whole chain", async () => {
    const stored = await t.ctx.ledger.getBySeq(3);
    expect(stored?.payload).toEqual({ n: 3 });
    expect(recomputeHashes(stored!).matches).toBe(true);
    const v = await t.ctx.ledger.verify();
    expect(v).toMatchObject({ ok: true, checked: 5, headSeq: 5 });
    expect(await t.ctx.ledger.verify({ fromSeq: 2, toSeq: 4 })).toMatchObject({ ok: true, checked: 3 });
    expect(await t.ctx.ledger.verify({ streamId: "batch:b1" })).toMatchObject({ ok: true, checked: 2 });
  });

  it("lists with filters and cursor pagination", async () => {
    const page1 = await t.ctx.ledger.list({ limit: 2 });
    expect(page1.items.map((e) => e.seq)).toEqual([5, 4]);
    expect(page1.nextCursor).toBe("4");
    const page2 = await t.ctx.ledger.list({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((e) => e.seq)).toEqual([3, 2]);
    expect((await t.ctx.ledger.list({ streamId: "batch:b1", order: "asc" })).items.map((e) => e.seq)).toEqual([1, 3]);
    expect((await t.ctx.ledger.list({ eventType: "BatchParsed" })).items).toHaveLength(1);
    expect((await t.ctx.ledger.list({ fromSeq: 4, toSeq: 5 })).items).toHaveLength(2);
  });

  it("DB trigger rejects UPDATE and DELETE on ledger_entries", async () => {
    await rejectsWith(t.ctx.db.execute(sql`UPDATE ledger_entries SET actor = 'evil' WHERE seq = 1`), /append-only/);
    await rejectsWith(t.ctx.db.execute(sql`DELETE FROM ledger_entries WHERE seq = 1`), /append-only/);
    // TRUNCATE is refused either by the trigger or, earlier, by the FK from ariel_update_items.
    await rejectsWith(t.ctx.db.execute(sql`TRUNCATE ledger_entries`), /append-only|truncate/i);
  });

  it("DB trigger rejects an insert that does not continue the chain", async () => {
    await rejectsWith(
      t.ctx.db.insert(ledgerEntries).values({
        seq: 99,
        entryId: "00000000-0000-7000-8000-00000000ffff",
        streamId: "batch:b1",
        streamSeq: 3,
        eventType: "BatchParsed",
        batchId: null,
        actor: "evil",
        occurredAt: new Date().toISOString(),
        payload: {},
        payloadHash: ZERO64,
        prevHashGlobal: ZERO64,
        prevHashStream: ZERO64,
        entryHash: "f".repeat(64),
      }),
      /global chain mismatch/,
    );
  });

  it.skip("UPDATE as the restricted app role is rejected by missing grant (Postgres-only: PGlite runs as a single superuser; covered by drizzle/0001 GRANT block on DB_DRIVER=postgres)", () => {});

  it("verify() pinpoints a tampered payload (trigger disabled by a superuser, as in AC5)", async () => {
    await t.ctx.db.execute(sql`ALTER TABLE ledger_entries DISABLE TRIGGER trg_ledger_no_update`);
    try {
      await t.ctx.db.execute(sql`UPDATE ledger_entries SET payload = '{"n":999}'::jsonb WHERE seq = 2`);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE ledger_entries ENABLE TRIGGER trg_ledger_no_update`);
    }
    const v = await t.ctx.ledger.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBadSeq).toBe(2);
    expect(v.reason).toMatch(/payload hash mismatch/);
    const single = await t.ctx.ledger.getBySeq(2);
    expect(recomputeHashes(single!).matches).toBe(false);
    // Verification of a range that excludes the bad entry is still ok.
    expect((await t.ctx.ledger.verify({ fromSeq: 3 })).ok).toBe(true);
  });

  it("verify() detects a broken link when a header field is altered", async () => {
    await t.ctx.db.execute(sql`ALTER TABLE ledger_entries DISABLE TRIGGER trg_ledger_no_update`);
    try {
      await t.ctx.db.execute(sql`UPDATE ledger_entries SET payload = '{"n":2}'::jsonb WHERE seq = 2`);
      await t.ctx.db.execute(sql`UPDATE ledger_entries SET actor = 'user:forged' WHERE seq = 4`);
    } finally {
      await t.ctx.db.execute(sql`ALTER TABLE ledger_entries ENABLE TRIGGER trg_ledger_no_update`);
    }
    const v = await t.ctx.ledger.verify();
    expect(v).toMatchObject({ ok: false, firstBadSeq: 4, reason: "entry hash mismatch" });
  });
});
