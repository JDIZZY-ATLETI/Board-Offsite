import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { getMemberView } from "@/lib/queries/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { app, session, params }) => {
  requireRole(session, "Reviewer", "Admin");
  const sinPseudo = z.string().regex(/^[0-9a-f]{64}$/).parse(params.sinPseudo);
  const view = await getMemberView(app, sinPseudo);
  if (!view) throw notFound("member");
  return json(view);
});