import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/app-context";
import { requirePageSession } from "@/lib/auth/page-session";
import { canAccessEmployer } from "@/lib/auth/roles";
import { getBatchDetail, type BatchDetail } from "@/lib/queries/batches";
import { recordOutcomeCounts } from "@/lib/queries/records";
import type { Session } from "@/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BatchPageData {
  session: Session;
  batch: BatchDetail;
  /** Rows still undecided after validation (= HELD in later phases). */
  heldCount: number;
}

/**
 * Deduped per request across layout + page. Unknown or out-of-scope batches throw `notFound()` from the
 * `[batchId]` layout; `batches/not-found.tsx` renders it with a real 404 status because no `loading.tsx`
 * boundary sits above that layout (the dashboard and batches-list skeletons live in their own route groups).
 */
export const loadBatchPage = cache(async (batchId: string): Promise<BatchPageData> => {
  if (!UUID.test(batchId)) notFound();
  const session = await requirePageSession();
  const ctx = await getAppContext();
  const batch = await getBatchDetail(ctx, batchId);
  if (!batch || !canAccessEmployer(session, batch.employerId)) notFound();
  let heldCount = 0;
  if (batch.status === "VALIDATED") {
    const c = await recordOutcomeCounts(ctx, batchId);
    heldCount = c.pending;
  }
  return { session, batch, heldCount };
});