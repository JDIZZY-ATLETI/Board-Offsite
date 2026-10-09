"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface MaskedSINProps {
  /** `***-***-563` (always available). */
  masked: string | null;
  sinPseudo?: string | null;
  initials?: string;
  linkToMember?: boolean;
  /** Reveal (D5) ships behind ALLOW_SIN_REVEAL and is not built in Phase 1; prop kept for API parity. */
  canReveal?: boolean;
  className?: string;
}

/**
 * The only component that renders a SIN (P6). Phase 1 is render-only: never shows more than the last 3 digits.
 * `aria-label="SIN ending in 563"`.
 */
export function MaskedSIN({ masked, sinPseudo, initials, linkToMember = false, className }: MaskedSINProps) {
  const safe = toSafeMask(masked);
  const last3 = safe.slice(-3);
  const body = (
    <span className={cn("inline-flex items-baseline gap-1.5", className)} data-testid="masked-sin">
      <span className="font-mono text-small text-ink" aria-label={/^\d{3}$/.test(last3) ? `SIN ending in ${last3}` : "SIN not available"}>
        {safe}
      </span>
      {initials ? <span className="text-small text-ink-muted">{initials}</span> : null}
    </span>
  );
  if (linkToMember && sinPseudo) {
    return (
      <Link href={`/members/${encodeURIComponent(sinPseudo)}`} className="rounded-sm hover:underline">
        {body}
      </Link>
    );
  }
  return body;
}

/** Defensive: whatever is passed in, only the last three characters may be digits. */
export function toSafeMask(masked: string | null | undefined): string {
  if (!masked) return "***-***-***";
  const digits = masked.replace(/\D/g, "");
  if (digits.length === 0) return "***-***-***";
  return `***-***-${digits.slice(-3).padStart(3, "*")}`;
}