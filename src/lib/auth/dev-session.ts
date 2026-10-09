import { ROLES, type Role } from "@/types/auth";

/**
 * Dev-only cookie session used by the UI (docs/ux-design.md section 5.10, architecture section 13.1).
 * The cookie carries the same three facts the `HeaderAuthProvider` reads from headers; `middleware.ts`
 * copies them onto the request so pages and route handlers share one auth path. Edge-safe: no Node imports.
 */
export const DEV_SESSION_COOKIE = "hoopp_dev_session";
export const DEV_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export interface DevSessionCookie {
  userId: string;
  role: Role;
  employerId: string | null;
}

export const USER_ID_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;
export const EMPLOYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function toBase64Url(s: string): string {
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    return typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function encodeDevSession(s: DevSessionCookie): string {
  return toBase64Url(JSON.stringify({ u: s.userId, r: s.role, e: s.employerId ?? null }));
}

/** Returns null for anything malformed; never throws (middleware hot path). */
export function decodeDevSession(value: string | undefined | null): DevSessionCookie | null {
  if (!value) return null;
  const raw = fromBase64Url(value);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { u?: unknown; r?: unknown; e?: unknown };
    if (typeof o.u !== "string" || !USER_ID_PATTERN.test(o.u)) return null;
    if (typeof o.r !== "string" || !(ROLES as readonly string[]).includes(o.r)) return null;
    const employerId = typeof o.e === "string" && EMPLOYER_ID_PATTERN.test(o.e) ? o.e : null;
    if (o.r === "EmployerSubmitter" && !employerId) return null;
    return { userId: o.u, role: o.r as Role, employerId };
  } catch {
    return null;
  }
}

export interface DevPersona extends DevSessionCookie {
  id: string;
  displayName: string;
  description: string;
}

/** Seeded personas offered on /login (non-production only). */
export const DEV_PERSONAS: readonly DevPersona[] = [
  { id: "submitter-0235", userId: "jsmith", role: "EmployerSubmitter", employerId: "0235", displayName: "J. Smith", description: "Employer Submitter · 0235 St. Michael's" },
  { id: "submitter-0359", userId: "mlee", role: "EmployerSubmitter", employerId: "0359", displayName: "M. Lee", description: "Employer Submitter · 0359 Lakeridge Health" },
  { id: "reviewer", userId: "rpatel", role: "Reviewer", employerId: null, displayName: "R. Patel", description: "HOOPP Reviewer · all employers, read ledger" },
  { id: "admin", userId: "admin", role: "Admin", employerId: null, displayName: "Admin", description: "Administrator · everything incl. verify" },
];

/** Dev-only display names for employer codes; the file world uses the code. */
export const EMPLOYER_NAMES: Readonly<Record<string, string>> = {
  "0235": "St. Michael's",
  "0359": "Lakeridge Health",
  "0135": "Grand River",
};