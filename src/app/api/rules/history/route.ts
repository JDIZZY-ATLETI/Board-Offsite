import { json, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { SYSTEM_STREAM } from "@/lib/ledger/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change history = RulesConfigChanged entries on the `system` stream. */
export const GET = withApi(async (_req, { app, session }) => {
  requireRole(session, "Reviewer", "Admin");
  const page = await app.ledger.list({ streamId: SYSTEM_STREAM, eventType: "RulesConfigChanged", limit: 100, order: "desc" });
  return json(page);
});