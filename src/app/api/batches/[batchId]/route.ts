import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { canAccessEmployer, canViewPrivateFindings } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { getBatchDetail } from "@/lib/queries/batches";
import { PRIVATE_REPORTS } from "@/lib/queries/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export const GET = withApi(async (_req, { app, session, params }) => {
  const s = requireSession(session);
  const batchId = idSchema.parse(params.batchId);
  const detail = await getBatchDetail(app, batchId);
  if (!detail || !canAccessEmployer(s, detail.employerId)) throw notFound("batch");
  // HOOPP-only reports (private summary, snapshot, config) are not even listed for Submitters.
  return json(canViewPrivateFindings(s) ? detail : { ...detail, reports: detail.reports.filter((r) => !PRIVATE_REPORTS.has(r.name)) });
});
