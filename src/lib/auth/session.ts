import { ROLES, type Role, type Session } from "@/types";
import { ApiError } from "@/lib/api/errors";

export interface AuthProvider {
  getSession(req: Request): Promise<Session | null>;
}

/**
 * Dev-only header auth (architecture section 13.1): `x-user-id`, `x-user-role` (alias `x-role`),
 * `x-employer-id`. `src/middleware.ts` strips these from every inbound request and re-populates them from
 * the dev session cookie, so over HTTP they can only originate from the middleware. In production the
 * provider refuses header identities outright (QA BUG-SEC-1); an Entra ID provider replaces it there.
 */
export class HeaderAuthProvider implements AuthProvider {
  async getSession(req: Request): Promise<Session | null> {
    if (process.env.NODE_ENV === "production") return null;
    const userId = req.headers.get("x-user-id")?.trim();
    const roleRaw = (req.headers.get("x-user-role") ?? req.headers.get("x-role"))?.trim();
    const employerId = req.headers.get("x-employer-id")?.trim() || null;
    if (!userId || !roleRaw) return null;
    if (!(ROLES as readonly string[]).includes(roleRaw)) throw new ApiError(401, "INVALID_ROLE", `unknown role "${roleRaw}"`);
    const role = roleRaw as Role;
    if (role === "EmployerSubmitter" && !employerId) {
      throw new ApiError(401, "EMPLOYER_REQUIRED", "EmployerSubmitter sessions must carry x-employer-id");
    }
    if (!/^[A-Za-z0-9._@-]{1,128}$/.test(userId)) throw new ApiError(401, "INVALID_USER", "invalid x-user-id");
    return { userId, role, employerId, actor: `user:${userId}` };
  }
}

let provider: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!provider) provider = new HeaderAuthProvider();
  return provider;
}

export function setAuthProviderForTests(p: AuthProvider | null): void {
  provider = p;
}

export function getSession(req: Request): Promise<Session | null> {
  return getAuthProvider().getSession(req);
}

export function requireSession(session: Session | null): Session {
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "authentication required");
  return session;
}

export function requireRole(session: Session | null, ...roles: Role[]): Session {
  const s = requireSession(session);
  if (!roles.includes(s.role)) throw new ApiError(403, "FORBIDDEN", `role ${s.role} may not perform this action`);
  return s;
}
