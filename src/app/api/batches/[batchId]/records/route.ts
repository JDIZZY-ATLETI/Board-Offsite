import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { json, parseQuery, withApi } from "@/lib/api/handler";
import { limitSchema } from "@/lib/api/pagination";
import { canAccessEmployer } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { getBatchDetail } from "@/lib/queries/batches";
import { listRecords } from "@/lib/queries/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  accepted: z.enum(["true", "false", "held"]).optional(),
  cursor: z.coerce.number().int().optional(),
  limit: limitSchema,
});

export const GET = withApi(async (_req, { app, session, params, url }) => {
  const s = requireSession(session);
  const batchId = z.string().uuid().parse(params.batchId);
  const batch = await getBatchDetail(app, batchId);
  if (!batch || !canAccessEmployer(s, batch.employerId)) throw notFound("batch");
  const q = parseQuery(url, query);
  const page = await listRecords(app, batchId, { accepted: q.accepted, cursor: q.cursor !== undefined ? String(q.cursor) : null, limit: q.limit });
  return json(page);
});
