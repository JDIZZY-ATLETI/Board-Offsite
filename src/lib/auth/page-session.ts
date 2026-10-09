import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, Session } from "@/types";
import { getSession } from "./session";

/** Resolves the session for a server component from the request headers (set by middleware or a client). */
export async function getPageSession(): Promise<Session | null> {
  const h = await headers();
  try {
    return await getSession(new Request("http://app.local/", { headers: h }));
  } catch {
    return null;
  }
}

/** Redirects to the dev login when unauthenticated. */
export async function requirePageSession(): Promise<Session> {
  const s = await getPageSession();
  if (!s) redirect("/login");
  return s;
}

/** Hidden nav is also server-enforced: wrong role lands on /forbidden (docs/ux-design.md section 2.2). */
export async function requirePageRole(...roles: Role[]): Promise<Session> {
  const s = await requirePageSession();
  if (!roles.includes(s.role)) redirect("/forbidden");
  return s;
}

export type AppEnv = "local" | "dev" | "prod";

export function appEnv(): AppEnv {
  if (process.env.NODE_ENV === "production") return process.env.APP_ENV === "dev" ? "dev" : "prod";
  return "local";
}