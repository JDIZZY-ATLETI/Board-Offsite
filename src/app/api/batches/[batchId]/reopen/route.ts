import { z } from "zod";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { clientIp } from "@/lib/api/update-set-handlers";
import { requireRole } from "@/lib/auth/session";
import { reopenBatch } from "@/lib/pipeline/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ reason: z.string().trim().min(1).max(2000), revalidate: z.boolean().optional() });

/** Admin only (architecture section 11): REJECTED -> VALIDATED, then rebuild when nothing is HELD. */
export const POST = withApi(async (req, { app, session, params }) => {
  const s = requireRole(session, "Admin");
  const batchId = z.string().uuid().parse(params.batchId);
  const b = await parseJsonBody(req, body);
  return json(await reopenBatch(app, s, batchId, b.reason, { ip: clientIp(req), revalidate: b.revalidate }));
});
