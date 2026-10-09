import { z } from "zod";
import { ApiError, notFound } from "@/lib/api/errors";
import { json, parseQuery, withApi } from "@/lib/api/handler";
import { limitSchema } from "@/lib/api/pagination";
import { canAccessEmployer, canViewPrivateFindings } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { getBatchDetail } from "@/lib/queries/batches";
import { listFindings } from "@/lib/queries/findings";
import { FINDING_SEVERITIES, FINDING_VISIBILITIES } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  severity: z.enum(FINDING_SEVERITIES).optional(),
  ruleId: z.string().min(1).max(64).optional(),
  lineNumber: z.coerce.number().int().positive().optional(),
  rowNumber: z.coerce.number().int().positive().optional(),
  visibility: z.enum(FINDING_VISIBILITIES).optional(),
  cursor: z.string().optional(),
  limit: limitSchema,
});

export const GET = withApi(async (_req, { app, session, params, url }) => {
  const s = requireSession(session);
  const batchId = z.string().uuid().parse(params.batchId);
  const batch = await getBatchDetail(app, batchId);
  if (!batch || !canAccessEmployer(s, batch.employerId)) throw notFound("batch");
  const q = parseQuery(url, query);
  const includePrivate = canViewPrivateFindings(s);
  if (q.visibility === "PRIVATE" && !includePrivate) throw new ApiError(403, "FORBIDDEN", "PRIVATE findings are HOOPP-only");
  const page = await listFindings(app, batchId, {
    severity: q.severity,
    ruleId: q.ruleId,
    lineNumber: q.lineNumber ?? q.rowNumber,
    visibility: q.visibility,
    includePrivate,
    cursor: q.cursor,
    limit: q.limit,
  });
  return json(page);
});
