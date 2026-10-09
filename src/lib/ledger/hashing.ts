import { canonicalize } from "@/lib/crypto/canonical";
import { sha256Hex } from "@/lib/crypto/hash";
import type { LedgerEntry } from "@/types";

export const HASH_RECIPE_VERSION = 1;

export function payloadHashOf(payload: Record<string, unknown>): string {
  return sha256Hex(canonicalize(payload));
}

export type EntryHeader = Pick<
  LedgerEntry,
  | "seq"
  | "entryId"
  | "streamId"
  | "streamSeq"
  | "eventType"
  | "batchId"
  | "actor"
  | "occurredAt"
  | "payloadHash"
  | "prevHashGlobal"
  | "prevHashStream"
>;

/** Byte-exact header string per architecture section 9.2. */
export function headerStringOf(h: EntryHeader): string {
  return canonicalize({
    v: HASH_RECIPE_VERSION,
    seq: h.seq,
    entryId: h.entryId,
    streamId: h.streamId,
    streamSeq: h.streamSeq,
    eventType: h.eventType,
    batchId: h.batchId,
    actor: h.actor,
    occurredAt: h.occurredAt,
    payloadHash: h.payloadHash,
    prevHashGlobal: h.prevHashGlobal,
    prevHashStream: h.prevHashStream,
  });
}

export function entryHashOf(h: EntryHeader): string {
  return sha256Hex(headerStringOf(h));
}

/** RFC 3339 UTC with millisecond precision and Z suffix, regardless of how the driver returned it. */
export function normalizeTimestamp(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp: ${String(value)}`);
  return d.toISOString();
}
