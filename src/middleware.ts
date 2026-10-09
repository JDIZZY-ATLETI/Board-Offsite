import { NextResponse, type NextRequest } from "next/server";
import { decodeDevSession, DEV_SESSION_COOKIE } from "@/lib/auth/dev-session";
import { IDENTITY_HEADERS } from "@/lib/auth/identity-headers";

/**
 * Identity-header boundary (architecture section 13.1, QA BUG-SEC-1).
 *
 * Inbound `x-user-*` / `x-role` headers are NEVER trusted: every request has them stripped before it
 * reaches a route handler or page, so the only identity a handler can observe is the one this middleware
 * bridged from the dev session cookie (non-production only). In production nothing is bridged and
 * `HeaderAuthProvider` additionally refuses every header identity, so a bypassed matcher cannot mint a session.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  for (const name of IDENTITY_HEADERS) headers.delete(name);

  if (process.env.NODE_ENV === "production") return NextResponse.next({ request: { headers } });

  const session = decodeDevSession(req.cookies.get(DEV_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.next({ request: { headers } });

  // Cookie-authenticated mutations must come from our own origin (CSRF guard; SameSite=Lax covers the rest).
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-origin request rejected" } }, { status: 403 });
    }
  }

  headers.set("x-user-id", session.userId);
  headers.set("x-user-role", session.role);
  if (session.employerId) headers.set("x-employer-id", session.employerId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
