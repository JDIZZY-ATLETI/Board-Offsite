import { z } from "zod";
import { ApiError, notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { canAccessEmployer, canViewPrivateFindings } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { getBatchDetail } from "@/lib/queries/batches";
import { auditPiiDownload, PII_REPORTS, PRIVATE_REPORTS, readReport, REPORT_NAMES } from "@/lib/queries/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, { app, session, params }) => {
  const s = requireSession(session);
  const batchId = z.string().uuid().parse(params.batchId);
  const name = z.enum(REPORT_NAMES).parse(params.name);
  const batch = await getBatchDetail(app, batchId);
  if (!batch || !canAccessEmployer(s, batch.employerId)) throw notFound("batch");
  if (PRIVATE_REPORTS.has(name) && !canViewPrivateFindings(s)) throw new ApiError(403, "FORBIDDEN", "This report is HOOPP-only");
  const report = await readReport(app, batch, name);
  if (!report) throw notFound(`report ${name}`);
  if (PII_REPORTS.has(name)) {
    await auditPiiDownload(app, s, batchId, name, req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null);
  }
  const download = name.endsWith(".csv") || name.endsWith(".ndjson");
  return new Response(new Uint8Array(report.bytes), {
    status: 200,
    headers: {
      "content-type": report.contentType,
      "content-length": String(report.bytes.length),
      "cache-control": "no-store",
      ...(download ? { "content-disposition": `attachment; filename="${batchId}-${name}"` } : {}),
    },
  });
});
