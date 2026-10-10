import { z } from "zod";
import { ApiError, notFound } from "@/lib/api/errors";
import { json, parseJsonBody, parseQuery, type HandlerCtx } from "@/lib/api/handler";
import { limitSchema } from "@/lib/api/pagination";
import { requireRole } from "@/lib/auth/session";
import { approveUpdateSet, exportUpdateSet, rejectUpdateSet, resolveUpdateSet } from "@/lib/pipeline/approval";
import { getUpdateSetView } from "@/lib/queries/update-sets";
import { ARIEL_OPERATIONS, ARIEL_RECORD_TYPES, EVENT_TYPES } from "@/types";

/**
 * Shared handler bodies for `/api/batches/{batchId}/update-set[/...]` and `/api/update-sets/{updateSetId}[/...]`
 * (architecture section 11 lists both shapes). Reviewer/Admin only: Submitters see status + rejection reason on
 * the batch detail (UX D4), never the derived items (section 13.1).
 */
export type UpdateSetRef = { batchId: string } | { updateSetId: string };

const uuid = z.string().uuid();

export function refFromParams(params: Record<string, string>): UpdateSetRef {
  if (params.updateSetId) return { updateSetId: uuid.parse(params.updateSetId) };
  return { batchId: uuid.parse(params.batchId) };
}

const viewQuery = z.object({
  recordType: z.enum(ARIEL_RECORD_TYPES).optional(),
  operation: z.enum(ARIEL_OPERATIONS).optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  sinPseudo: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  q: z.string().max(64).optional(),
  cursor: z.string().max(80).optional(),
  limit: limitSchema,
});

export async function handleGetUpdateSet(_req: Request, { app, session, params, url }: HandlerCtx): Promise<Response> {
  const s = requireRole(session, "Reviewer", "Admin");
  const ref = refFromParams(params);
  const q = parseQuery(url, viewQuery);
  const { batch, set } = await resolveUpdateSet(app, s, ref);
  if (!set) {
    return json({ updateSet: null, batch: { batchId: batch.batchId, status: batch.status, heldRows: batch.heldTotal, employerId: batch.employerId }, members: [], approvals: [], exports: [], nextCursor: null, filteredItemCount: 0 }, { status: 200 });
  }
  const view = await getUpdateSetView(app, set, q);
  return json({
    ...view,
    batch: { batchId: batch.batchId, status: batch.status, heldRows: batch.heldTotal, employerId: batch.employerId, currentUpdateSetId: batch.updateSetId, rejection: batch.rejectedReason ? { reason: batch.rejectedReason, actor: batch.rejectedBy, at: batch.rejectedAt ? new Date(batch.rejectedAt).toISOString() : null } : null },
    isCurrent: !batch.updateSetId || batch.updateSetId === set.updateSetId,
  });
}

export async function handleGetDiff(_req: Request, { app, session, params }: HandlerCtx): Promise<Response> {
  const s = requireRole(session, "Reviewer", "Admin");
  const { set } = await resolveUpdateSet(app, s, refFromParams(params));
  if (!set || !set.artifacts.diffMd || !(await app.lake.exists(set.artifacts.diffMd))) throw notFound("diff");
  const bytes = await app.lake.get(set.artifacts.diffMd);
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}

const approveBody = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** UX D3: comment required, >= 10 characters, plus attestation. */
  note: z.string().trim().min(10).max(2000),
  attest: z.literal(true),
});

export async function handleApprove(req: Request, { app, session, params }: HandlerCtx): Promise<Response> {
  const s = requireRole(session, "Reviewer", "Admin");
  const body = await parseJsonBody(req, approveBody);
  const r = await approveUpdateSet(app, s, refFromParams(params), body, { ip: clientIp(req) });
  return json(r);
}

const rejectBody = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(1).max(2000),
});

export async function handleReject(req: Request, { app, session, params }: HandlerCtx): Promise<Response> {
  const s = requireRole(session, "Reviewer", "Admin");
  const body = await parseJsonBody(req, rejectBody);
  const r = await rejectUpdateSet(app, s, refFromParams(params), body, { ip: clientIp(req) });
  return json(r);
}

const exportBody = z.object({ format: z.enum(["json", "csv", "both"]).default("both") });

export async function handleExport(req: Request, { app, session, params }: HandlerCtx): Promise<Response> {
  const s = requireRole(session, "Reviewer", "Admin");
  const body = await parseJsonBody(req, exportBody);
  const r = await exportUpdateSet(app, s, refFromParams(params), body.format, { ip: clientIp(req) });
  return json(r);
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
}

export { ApiError };