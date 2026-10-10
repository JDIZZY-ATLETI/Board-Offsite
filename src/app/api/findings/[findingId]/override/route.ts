import { z } from "zod";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireSession } from "@/lib/auth/session";
import { overrideFinding } from "@/lib/pipeline/override";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overrideBodySchema = z.object({
  reason: z.string().min(1).max(500),
  note: z.string().max(2000).optional(),
});

/** POST /api/findings/{findingId}/override (architecture section 11). */
export const POST = withApi(async (req, { app, session, params }) => {
  const s = requireSession(session);
  const findingId = z.string().uuid().parse(params.findingId);
  const body = await parseJsonBody(req, overrideBodySchema);
  const result = await overrideFinding(app, s, findingId, body, { batchId: params.batchId ? z.string().uuid().parse(params.batchId) : undefined, ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null });
  return json(result);
});