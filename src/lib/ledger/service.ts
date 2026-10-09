import { and, asc, count, desc, eq, gt, gte, like, lt, lte, max } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ZERO64 } from "@/lib/crypto/hash";
import type { Db, DbOrTx, Tx } from "@/lib/db/client";
import { GLOBAL_STREAM, ledgerEntries, ledgerHeads } from "@/lib/db/schema";
import type { LedgerEntry, LedgerEventType, LedgerHead, VerificationResult } from "@/types";
import { entryHashOf, normalizeTimestamp, payloadHashOf } from "./hashing";

export interface LedgerDraft {
  streamId: string;
  eventType: LedgerEventType;
  batchId: string | null;
  actor: string;
  payload: Record<string, unknown>;
}

export interface LedgerDeps {
  clock?: () => Date;
  newId?: () => string;
}

export interface ListEntriesParams {
  streamId?: string;
  /** Filter by stream family: batch:*, member:* or the system stream. */
  streamKind?: "batch" | "member" | "system";
  batchId?: string;
  eventType?: LedgerEventType;
  fromSeq?: number;
  toSeq?: number;
  cursor?: string | null;
  limit?: number;
  order?: "asc" | "desc";
}

export interface ListEntriesResult {
  items: LedgerEntry[];
  nextCursor: string | null;
}

export interface VerifyParams {
  fromSeq?: number;
  toSeq?: number;
  streamId?: string;
}

type Row = typeof ledgerEntries.$inferSelect;

export function rowToEntry(r: Row): LedgerEntry {
  return {
    seq: Number(r.seq),
    entryId: r.entryId,
    streamId: r.streamId,
    streamSeq: Number(r.streamSeq),
    eventType: r.eventType as LedgerEventType,
    batchId: r.batchId,
    actor: r.actor,
    occurredAt: normalizeTimestamp(r.occurredAt),
    payload: r.payload,
    payloadHash: r.payloadHash,
    prevHashGlobal: r.prevHashGlobal,
    prevHashStream: r.prevHashStream,
    entryHash: r.entryHash,
  };
}

export function recomputeHashes(e: LedgerEntry): { payloadHash: string; entryHash: string; matches: boolean } {
  const payloadHash = payloadHashOf(e.payload);
  const entryHash = entryHashOf({ ...e, payloadHash });
  return { payloadHash, entryHash, matches: payloadHash === e.payloadHash && entryHash === e.entryHash };
}

export class LedgerService {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly db: Db,
    deps: LedgerDeps = {},
  ) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? uuidv7;
  }

  /** Appends one entry. Uses the caller's transaction when given, otherwise opens one. */
  async append(draft: LedgerDraft, tx?: DbOrTx): Promise<LedgerEntry> {
    const [e] = await this.appendMany([draft], tx);
    return e;
  }

  /** Appends several entries atomically, in order, under the global head lock. */
  async appendMany(drafts: LedgerDraft[], tx?: DbOrTx): Promise<LedgerEntry[]> {
    if (drafts.length === 0) return [];
    if (tx) return this.appendInTx(drafts, tx);
    return this.db.transaction((t) => this.appendInTx(drafts, t));
  }

  private async appendInTx(drafts: LedgerDraft[], tx: DbOrTx): Promise<LedgerEntry[]> {
    const [g] = await tx.select().from(ledgerHeads).where(eq(ledgerHeads.streamId, GLOBAL_STREAM)).for("update");
    if (!g) throw new Error("ledger_heads has no __global__ row; run migrations");
    let seq = Number(g.lastSeq);
    let prevGlobal = g.lastHash;
    // Stream heads seen in this chunk, so consecutive entries on one stream chain correctly.
    const streamState = new Map<string, { seq: number; hash: string }>();
    const out: LedgerEntry[] = [];
    for (const d of drafts) {
      let s = streamState.get(d.streamId);
      if (!s) {
        const [row] = await tx.select().from(ledgerHeads).where(eq(ledgerHeads.streamId, d.streamId)).for("update");
        s = row ? { seq: Number(row.lastSeq), hash: row.lastHash } : { seq: 0, hash: ZERO64 };
      }
      seq += 1;
      const payloadHash = payloadHashOf(d.payload);
      const header = {
        seq,
        entryId: this.newId(),
        streamId: d.streamId,
        streamSeq: s.seq + 1,
        eventType: d.eventType,
        batchId: d.batchId,
        actor: d.actor,
        occurredAt: this.clock().toISOString(),
        payloadHash,
        prevHashGlobal: prevGlobal,
        prevHashStream: s.hash,
      };
      const entryHash = entryHashOf(header);
      const entry: LedgerEntry = { ...header, payload: d.payload, entryHash };
      await tx.insert(ledgerEntries).values({
        seq: entry.seq,
        entryId: entry.entryId,
        streamId: entry.streamId,
        streamSeq: entry.streamSeq,
        eventType: entry.eventType,
        batchId: entry.batchId,
        actor: entry.actor,
        occurredAt: entry.occurredAt,
        payload: entry.payload,
        payloadHash: entry.payloadHash,
        prevHashGlobal: entry.prevHashGlobal,
        prevHashStream: entry.prevHashStream,
        entryHash: entry.entryHash,
      });
      prevGlobal = entryHash;
      streamState.set(d.streamId, { seq: entry.streamSeq, hash: entryHash });
      out.push(entry);
    }
    return out;
  }

  async head(db: DbOrTx = this.db): Promise<LedgerHead> {
    const [g] = await db.select().from(ledgerHeads).where(eq(ledgerHeads.streamId, GLOBAL_STREAM));
    const [{ n }] = await db.select({ n: count() }).from(ledgerHeads);
    return { seq: g ? Number(g.lastSeq) : 0, hash: g?.lastHash ?? ZERO64, streams: Math.max(0, Number(n) - 1) };
  }

  async getBySeq(seq: number): Promise<LedgerEntry | null> {
    const [row] = await this.db.select().from(ledgerEntries).where(eq(ledgerEntries.seq, seq));
    return row ? rowToEntry(row) : null;
  }

  async list(params: ListEntriesParams = {}): Promise<ListEntriesResult> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const order = params.order ?? "desc";
    const conds = [];
    if (params.streamId) conds.push(eq(ledgerEntries.streamId, params.streamId));
    if (params.streamKind === "system") conds.push(eq(ledgerEntries.streamId, "system"));
    else if (params.streamKind) conds.push(like(ledgerEntries.streamId, `${params.streamKind}:%`));
    if (params.batchId) conds.push(eq(ledgerEntries.batchId, params.batchId));
    if (params.eventType) conds.push(eq(ledgerEntries.eventType, params.eventType));
    if (params.fromSeq !== undefined) conds.push(gte(ledgerEntries.seq, params.fromSeq));
    if (params.toSeq !== undefined) conds.push(lte(ledgerEntries.seq, params.toSeq));
    if (params.cursor) {
      const c = Number(params.cursor);
      if (!Number.isInteger(c)) throw new Error("invalid cursor");
      conds.push(order === "asc" ? gt(ledgerEntries.seq, c) : lt(ledgerEntries.seq, c));
    }
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(order === "asc" ? asc(ledgerEntries.seq) : desc(ledgerEntries.seq))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(rowToEntry);
    const nextCursor = rows.length > limit ? String(items[items.length - 1].seq) : null;
    return { items, nextCursor };
  }

  /** Architecture section 9.4. Streams the chain in pages and recomputes every hash. */
  async verify(params: VerifyParams = {}): Promise<VerificationResult> {
    const started = Date.now();
    const headNow = await this.head();
    const from = Math.max(1, params.fromSeq ?? 1);
    const to = params.toSeq ?? headNow.seq;
    const finish = (partial: Omit<VerificationResult, "headSeq" | "headHash" | "durationMs">): VerificationResult => ({
      ...partial,
      headSeq: headNow.seq,
      headHash: headNow.hash,
      durationMs: Date.now() - started,
    });

    let expectedPrevGlobal = ZERO64;
    if (from > 1) {
      const prev = await this.getBySeq(from - 1);
      if (!prev) return finish({ ok: false, checked: 0, firstBadSeq: from - 1, reason: "missing predecessor entry" });
      expectedPrevGlobal = prev.entryHash;
    }
    const streamExpect = new Map<string, { seq: number; hash: string }>();
    const seedStream = async (streamId: string) => {
      const [row] = await this.db
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.streamId, streamId), lt(ledgerEntries.seq, from)))
        .orderBy(desc(ledgerEntries.seq))
        .limit(1);
      const st = row ? { seq: Number(row.streamSeq), hash: row.entryHash } : { seq: 0, hash: ZERO64 };
      streamExpect.set(streamId, st);
      return st;
    };

    let checked = 0;
    let expectedSeq = from;
    let lastHash = expectedPrevGlobal;
    const PAGE = 1000;
    let cursor = from - 1;
    for (;;) {
      const rows = await this.db
        .select()
        .from(ledgerEntries)
        .where(and(gt(ledgerEntries.seq, cursor), lte(ledgerEntries.seq, to)))
        .orderBy(asc(ledgerEntries.seq))
        .limit(PAGE);
      if (rows.length === 0) break;
      for (const row of rows) {
        const e = rowToEntry(row);
        cursor = e.seq;
        if (params.streamId && e.streamId !== params.streamId) {
          // Still part of the global chain: advance global expectations without stream checks.
          if (e.seq !== expectedSeq) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: `seq gap: expected ${expectedSeq}` });
          const r = recomputeHashes(e);
          if (!r.matches || e.prevHashGlobal !== expectedPrevGlobal) {
            return finish({ ok: false, checked, firstBadSeq: e.seq, reason: "hash or global link mismatch" });
          }
          expectedPrevGlobal = e.entryHash;
          lastHash = e.entryHash;
          expectedSeq += 1;
          continue;
        }
        if (e.seq !== expectedSeq) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: `seq gap: expected ${expectedSeq}` });
        const r = recomputeHashes(e);
        if (r.payloadHash !== e.payloadHash) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: "payload hash mismatch" });
        if (r.entryHash !== e.entryHash) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: "entry hash mismatch" });
        if (e.prevHashGlobal !== expectedPrevGlobal) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: "global chain link mismatch" });
        const st = streamExpect.get(e.streamId) ?? (await seedStream(e.streamId));
        if (e.streamSeq !== st.seq + 1) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: `stream seq gap in ${e.streamId}` });
        if (e.prevHashStream !== st.hash) return finish({ ok: false, checked, firstBadSeq: e.seq, reason: `stream chain link mismatch in ${e.streamId}` });
        streamExpect.set(e.streamId, { seq: e.streamSeq, hash: e.entryHash });
        expectedPrevGlobal = e.entryHash;
        lastHash = e.entryHash;
        expectedSeq += 1;
        checked += 1;
      }
      if (rows.length < PAGE) break;
    }

    if (params.toSeq === undefined) {
      if (headNow.seq !== expectedSeq - 1 || (headNow.seq > 0 && headNow.hash !== lastHash)) {
        return finish({ ok: false, checked, firstBadSeq: headNow.seq, reason: "ledger_heads does not match chain tail" });
      }
      const [{ n, m }] = await this.db.select({ n: count(), m: max(ledgerEntries.seq) }).from(ledgerEntries);
      if (Number(n) !== Number(m ?? 0)) return finish({ ok: false, checked, reason: `count ${n} != max(seq) ${m}` });
    }
    return finish({ ok: true, checked });
  }
}

export type { Tx };
