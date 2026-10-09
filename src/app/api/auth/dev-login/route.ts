import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { DEV_SESSION_COOKIE, DEV_SESSION_MAX_AGE_SECONDS, EMPLOYER_ID_PATTERN, encodeDevSession, USER_ID_PATTERN } from "@/lib/auth/dev-session";
import { auditLog } from "@/lib/db/schema";
import { ROLES } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  userId: z.string().regex(USER_ID_PATTERN),
  role: z.enum(ROLES),
  employerId: z.string().regex(EMPLOYER_ID_PATTERN).optional().nullable(),
});

function assertNonProduction(): void {
  if (process.env.NODE_ENV === "production") throw new ApiError(404, "NOT_FOUND", "dev login is disabled in production");
}

function cookie(value: string, maxAge: number): string {
  return `${DEV_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Sets the dev session cookie (docs/ux-design.md section 5.10). Login is audit-logged (architecture section 13.4). */
export const POST = withApi(async (req, { app }) => {
  assertNonProduction();
  const p = await parseJsonBody(req, body);
  const employerId = p.employerId ?? null;
  if (p.role === "EmployerSubmitter" && !employerId) throw new ApiError(400, "EMPLOYER_REQUIRED", "EmployerSubmitter needs an employerId");
  await app.db.insert(auditLog).values({
    at: app.clock().toISOString(),
    actor: `user:${p.userId}`,
    role: p.role,
    action: "DEV_LOGIN",
    target: employerId ? `employer:${employerId}` : null,
    ip: null,
    details: { provider: "header-dev" },
  });
  return json({ ok: true, userId: p.userId, role: p.role, employerId }, { headers: { "set-cookie": cookie(encodeDevSession({ userId: p.userId, role: p.role, employerId }), DEV_SESSION_MAX_AGE_SECONDS) } });
});

export const DELETE = withApi(async () => {
  assertNonProduction();
  return json({ ok: true }, { headers: { "set-cookie": cookie("", 0) } });
});