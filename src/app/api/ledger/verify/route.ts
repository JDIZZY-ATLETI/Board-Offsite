import { z } from "zod";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { verifyLedger } from "@/lib/queries/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  fromSeq: z.number().int().positive().optional(),
  toSeq: z.number().int().positive().optional(),
  streamId: z.string().min(1).max(200).optional(),
});

export const POST = withApi(async (req, { app, session }) => {
  const s = requireRole(session, "Admin");
  const p = await parseJsonBody(req, body);
  const result = await verifyLedger(app, p, s.actor);
  return json(result);
});
