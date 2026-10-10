import { z } from "zod";
import { ApiError, notFound } from "@/lib/api/errors";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { canAccessEmployer } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { canOverride, overrideFindings } from "@/lib/pipeline/override";
import { getBatchDetail } from "@/lib/queries/batches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  findingIds: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
});

/** Bulk override: one reason, one ledger entry per finding (docs/ux-design.md section 5.4.2). */
export const POST = withApi(async (req, { app, session, params }) => {
  const s = requireSession(session);
  const batchId = z.string().uuid().parse(params.batchId);
  const b = await parseJsonBody(req, body);
  const batch = await getBatchDetail(app, batchId);
  if (!batch || !canAccessEmployer(s, batch.employerId)) throw notFound("batch");
  if (!canOverride(app, s, batch.employerId)) throw new ApiError(403, "FORBIDDEN", s.role === "EmployerSubmitter" ? "Warning overrides are recorded by a HOOPP reviewer." : `role ${s.role} may not override warnings`);
  const result = await overrideFindings(app, s, b.findingIds, { reason: b.reason, note: b.note }, { batchId, ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null });
  const failed = result.results.filter((r) => !r.ok).length;
  if (failed === result.results.length) throw new ApiError(422, "NO_OVERRIDE_APPLIED", "None of the findings could be overridden.", { results: result.results });
  return json(result, { status: failed > 0 ? 207 : 200 });
});