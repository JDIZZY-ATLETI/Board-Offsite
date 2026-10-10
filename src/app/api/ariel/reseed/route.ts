import { ApiError } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { reseedArielMock } from "@/lib/ariel/reseed";
import { requireRole } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin, non-production: truncate + reload ariel_mock from tests/fixtures/ariel-seed.json. */
export const POST = withApi(async (_req, { app, session }) => {
  const s = requireRole(session, "Admin");
  if (process.env.NODE_ENV === "production") throw new ApiError(404, "NOT_FOUND", "mock reseed is disabled in production");
  const result = await reseedArielMock(app, s);
  return json({ ok: true, ...result });
});