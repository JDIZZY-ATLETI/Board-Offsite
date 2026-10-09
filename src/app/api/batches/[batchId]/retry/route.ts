import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, notFound } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { auditLog, batches, eventsRecords, validationFindings } from "@/lib/db/schema";
import { getJobRunner } from "@/lib/pipeline/jobs";
import { runBatch } from "@/lib/pipeline/run";
import { transitionBatch } from "@/lib/pipeline/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

/**
 * Architecture section 11: Admin retry of a FAILED batch on the same batchId (FAILED -> RECEIVED), then the
 * pipeline re-runs from the raw file. Projection rows from the failed attempt are dropped; the ledger is
 * append-only, so its entries stay and the re-run appends new ones. `?wait=true` runs inline (tests).
 */
export const POST = withApi(async (_req, { app, session, params, url, log }) => {
  const s = requireRole(session, "Admin");
  const batchId = idSchema.parse(params.batchId);
  const [batch] = await app.db.select({ status: batches.status }).from(batches).where(eq(batches.batchId, batchId));
  if (!batch) throw notFound("batch");
  if (batch.status !== "FAILED") throw new ApiError(409, "INVALID_STATE", `only FAILED batches can be retried (status is ${batch.status})`);
  const at = app.clock().toISOString();
  await app.db.transaction(async (tx) => {
    await tx.delete(validationFindings).where(eq(validationFindings.batchId, batchId));
    await tx.delete(eventsRecords).where(eq(eventsRecords.batchId, batchId));
    await tx.update(batches).set({ rowsTotal: 0, rowsAccepted: 0, rowsRejected: 0, warningsTotal: 0, infosTotal: 0 }).where(eq(batches.batchId, batchId));
    await transitionBatch(tx, { batchId, from: "FAILED", to: "RECEIVED", actor: s.actor, at, note: "admin retry", failureReason: null });
    await tx.insert(auditLog).values({ at, actor: s.actor, role: s.role, action: "BATCH_RETRY", target: `batch:${batchId}`, ip: null, details: {} });
  });
  log.info({ batchId }, "batch retry requested");

  if (url.searchParams.get("wait") === "true") {
    const status = await runBatch(app, batchId);
    return json({ batchId, status }, { status: 200 });
  }
  const runner = await getJobRunner();
  await runner.enqueue({ batchId });
  return json({ batchId, status: "RECEIVED" }, { status: 202 });
});
