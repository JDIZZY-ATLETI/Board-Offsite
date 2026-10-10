import { json, withApi } from "@/lib/api/handler";
import { requireSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { app, session }) => {
  requireSession(session);
  const rates = await app.ariel.rates();
  return json({ adapter: app.ariel.name, rows: rates.rows() });
});