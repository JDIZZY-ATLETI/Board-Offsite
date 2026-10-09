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
      durationMs: result.durationMs,
      ...(result.firstBadSeq !== undefined ? { firstBadSeq: result.firstBadSeq } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(p.fromSeq !== undefined ? { fromSeq: p.fromSeq } : {}),
      ...(p.toSeq !== undefined ? { toSeq: p.toSeq } : {}),
      ...(p.streamId ? { streamId: p.streamId } : {}),
    },
  });
  return { ...result, ledgerSeq: entry.seq };
}

/** Shape consumed by the IntegrityBanner (docs/ux-design.md section 4.13). */
export interface LastVerification {
  ok: boolean;
  checked: number;
  headSeq: number;
  headHash: string;
  verifiedAt: string;
  durationMs: number | null;
  firstBadSeq?: number;
  reason?: string;
  /** Ledger seq of the ChainAnchorPublished entry that recorded this result. */
  ledgerSeq: number;
  /** True when the verification covered a sub-range or a single stream rather than the whole chain. */
  partial: boolean;
}

/** Most recent whole-chain verification recorded on the system stream, or null when never verified. */
export async function getLastVerification(ctx: AppContext): Promise<LastVerification | null> {
  const page = await ctx.ledger.list({ streamId: SYSTEM_STREAM, eventType: "ChainAnchorPublished", limit: 20, order: "desc" });
  for (const e of page.items) {
    const p = e.payload as Record<string, unknown>;
    if (p.kind !== "verification") continue;
    return {
      ok: Boolean(p.ok),
      checked: Number(p.checked ?? 0),
      headSeq: Number(p.headSeq ?? 0),
      headHash: String(p.headHash ?? ""),
      verifiedAt: e.occurredAt,
      durationMs: typeof p.durationMs === "number" ? p.durationMs : null,
      ...(typeof p.firstBadSeq === "number" ? { firstBadSeq: p.firstBadSeq } : {}),
      ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
      ledgerSeq: e.seq,
      partial: p.fromSeq !== undefined || p.toSeq !== undefined || p.streamId !== undefined,
    };
  }
  return null;
}