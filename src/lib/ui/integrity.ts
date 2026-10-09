import type { LastVerification } from "@/lib/queries/ledger";
import type { IntegrityState } from "@/lib/ui/status-map";

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Pure helper shared by server pages and the client IntegrityBanner. */
export function integrityState(result: LastVerification | null, now = Date.now()): { state: IntegrityState; stale: boolean } {
  if (!result) return { state: "unverified", stale: false };
  if (!result.ok) return { state: "tampered", stale: false };
  const stale = now - new Date(result.verifiedAt).getTime() > STALE_AFTER_MS;
  return { state: "ok", stale };
}