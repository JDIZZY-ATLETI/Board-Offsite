import { NextResponse, type NextRequest } from "next/server";
import { decodeDevSession, DEV_SESSION_COOKIE } from "@/lib/auth/dev-session";

/**
 * Dev auth bridge: when a request carries the dev session cookie and no explicit `x-user-id`
 * header, copy the cookie facts onto the request headers that `HeaderAuthProvider` reads.
 * Disabled in production, where an Entra ID provider replaces header auth (architecture section 16).
 */
export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.next();
  if (req.headers.get("x-user-id")) return NextResponse.next();

  const session = decodeDevSession(req.cookies.get(DEV_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.next();

  // Cookie-authenticated mutations must come from our own origin (CSRF guard; SameSite=Lax covers the rest).
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-origin request rejected" } }, { status: 403 });
    }
  }

  const headers = new Headers(req.headers);
  headers.set("x-user-id", session.userId);
  headers.set("x-user-role", session.role);
  if (session.employerId) headers.set("x-employer-id", session.employerId);
  else headers.delete("x-employer-id");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};