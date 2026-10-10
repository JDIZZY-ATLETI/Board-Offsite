import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { clientIp } from "@/lib/api/update-set-handlers";
import { requireRole } from "@/lib/auth/session";
import { lookupMember } from "@/lib/queries/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ sin: z.string().min(1).max(32) });

/** Body only, never a query string; audit-logged; the response carries the pseudonym and mask, never the SIN. */
export const POST = withApi(async (req, { app, session }) => {
  const s = requireRole(session, "Reviewer", "Admin");
  const b = await parseJsonBody(req, body);
  const r = await lookupMember(app, s, b.sin, clientIp(req));
  if (!r) throw new ApiError(400, "INVALID_SIN", "SIN must be 9 digits.");
  return json(r);
});