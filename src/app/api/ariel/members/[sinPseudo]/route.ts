import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Member snapshot with SIN masked. Several members may share a pseudonym (B204 fixture). */
export const GET = withApi(async (_req, { app, session, params }) => {
  requireRole(session, "Reviewer", "Admin");
  const sinPseudo = z.string().regex(/^[0-9a-f]{64}$/).parse(params.sinPseudo);
  const members = await app.ariel.findMembersBySinPseudo(sinPseudo);
  if (members.length === 0) throw notFound("member");
  return json({ adapter: app.ariel.name, members });
});