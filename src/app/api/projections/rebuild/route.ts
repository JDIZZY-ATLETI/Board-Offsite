import { json, withApi } from "@/lib/api/handler";
import { clientIp } from "@/lib/api/update-set-handlers";
import { requireRole } from "@/lib/auth/session";
import { auditLog } from "@/lib/db/schema";
import { rebuildProjections } from "@/lib/projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: replay the ledger from seq 1 into member_projections (same as `npm run projections:rebuild`). */
export const POST = withApi(async (req, { app, session }) => {
  const s = requireRole(session, "Admin");
  const run = await rebuildProjections(app);
  const ip = clientIp(req);
  await app.db.insert(auditLog).values({ at: app.clock().toISOString(), actor: s.actor, role: s.role, action: "REBUILD_PROJECTIONS", target: "member_projections", ip: ip && /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null, details: run });
  return json(run);
});