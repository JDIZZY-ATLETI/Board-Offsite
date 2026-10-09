import type { AppContext } from "@/lib/app-context";
import { recomputeHashes, type ListEntriesParams, type VerifyParams } from "@/lib/ledger/service";
import { SYSTEM_STREAM, systemActor } from "@/lib/ledger/streams";
import type { LedgerEntry, LedgerHead, VerificationResult } from "@/types";

export function getLedgerHead(ctx: AppContext): Promise<LedgerHead> {
  return ctx.ledger.head();
}

export function listLedgerEntries(ctx: AppContext, p: ListEntriesParams) {
  return ctx.ledger.list(p);
}

export async function getLedgerEntry(ctx: AppContext, seq: number): Promise<(LedgerEntry & { recomputed: ReturnType<typeof recomputeHashes> }) | null> {
  const e = await ctx.ledger.getBySeq(seq);
  if (!e) return null;
  return { ...e, recomputed: recomputeHashes(e) };
}

/** Verifies and records the outcome on the system stream (architecture section 9.4). */
export async function verifyLedger(ctx: AppContext, p: VerifyParams, actor: string): Promise<VerificationResult & { ledgerSeq: number }> {
  const result = await ctx.ledger.verify(p);
  const entry = await ctx.ledger.append({
    streamId: SYSTEM_STREAM,
    eventType: "ChainAnchorPublished",
    batchId: null,
    actor: actor || systemActor("verify"),
    payload: {
      kind: "verification",
      ok: result.ok,
      checked: result.checked,
      headSeq: result.headSeq,
      headHash: result.headHash,
      ...(result.firstBadSeq !== undefined ? { firstBadSeq: result.firstBadSeq } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(p.fromSeq !== undefined ? { fromSeq: p.fromSeq } : {}),
      ...(p.toSeq !== undefined ? { toSeq: p.toSeq } : {}),
      ...(p.streamId ? { streamId: p.streamId } : {}),
    },
  });
  return { ...result, ledgerSeq: entry.seq };
}
