import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { getExport } from "@/lib/queries/update-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { app, session, params }) => {
  requireRole(session, "Reviewer", "Admin");
  const exp = await getExport(app, z.string().uuid().parse(params.exportId));
  if (!exp) throw notFound("export");
  return json(exp);
});
