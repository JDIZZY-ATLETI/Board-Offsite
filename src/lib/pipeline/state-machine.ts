import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { batches, batchStatusHistory } from "@/lib/db/schema";
import type { BatchStatus } from "@/types";

/** Architecture section 10.1. */
export const TRANSITIONS: Readonly<Record<BatchStatus, readonly BatchStatus[]>> = {
  RECEIVED: ["PARSED", "FILE_REJECTED", "FAILED"],
  PARSED: ["VALIDATED", "FAILED"],
  VALIDATED: ["VALIDATED", "LEDGERED", "FAILED"],
  LEDGERED: ["PROJECTION_BUILT", "FAILED"],
  PROJECTION_BUILT: ["PENDING_APPROVAL", "FAILED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["EXPORTED"],
  REJECTED: ["VALIDATED"],
  EXPORTED: [],
  FAILED: ["RECEIVED"],
  FILE_REJECTED: [],
};

export const TERMINAL_STATUSES: readonly BatchStatus[] = ["EXPORTED", "FILE_REJECTED"];
export const TRANSIENT_STATUSES: readonly BatchStatus[] = ["RECEIVED", "PARSED", "LEDGERED", "PROJECTION_BUILT"];

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: BatchStatus,
    public readonly to: BatchStatus,
  ) {
    super(`invalid batch transition ${from} -> ${to}`);
  }
}

export function canTransition(from: BatchStatus, to: BatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionInput {
  batchId: string;
  from: BatchStatus;
  to: BatchStatus;
  actor: string;
  note?: string;
  at: string;
  failureReason?: string | null;
}

/** Guards and records a status change. Caller supplies the transaction. */
export async function transitionBatch(tx: DbOrTx, input: TransitionInput): Promise<void> {
  if (!canTransition(input.from, input.to)) throw new InvalidTransitionError(input.from, input.to);
  const [row] = await tx.select({ status: batches.status }).from(batches).where(eq(batches.batchId, input.batchId));
  if (!row) throw new Error(`batch ${input.batchId} not found`);
  if (row.status !== input.from) throw new InvalidTransitionError(row.status, input.to);
  await tx
    .update(batches)
    .set({ status: input.to, updatedAt: input.at, ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}) })
    .where(eq(batches.batchId, input.batchId));
  await tx.insert(batchStatusHistory).values({
    batchId: input.batchId,
    fromStatus: input.from,
    toStatus: input.to,
    actor: input.actor,
    at: input.at,
    note: input.note ?? null,
  });
}
