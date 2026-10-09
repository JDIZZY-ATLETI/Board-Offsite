"use client";

import Link from "next/link";
import { Check, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortHash } from "@/lib/ui/format";
import { CopyButton } from "@/components/app/copy-button";

export interface HashChipProps {
  hash: string;
  label?: string;
  truncate?: 8 | 12;
  /** Result of a recomputed comparison when known. */
  verified?: boolean | null;
  href?: string;
  className?: string;
}

/** `9f86d081…0a08` mono + copy (+ link, + check/x when a comparison is known). docs/ux-design.md section 4.12. */
export function HashChip({ hash, label, truncate = 8, verified = null, href, className }: HashChipProps) {
  const short = shortHash(hash, truncate, 4);
  return (
    <span className={cn("inline-flex items-center gap-1 text-small", className)}>
      {label ? <span className="text-ink-muted">{label}</span> : null}
      <code title={hash} className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-caption text-ink">
        {short}
      </code>
      <CopyButton value={hash} label={`Copy full ${label ?? "hash"}`} />
      {href ? (
        <Link href={href} aria-label={`Open ${label ?? "entry"}`} className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-muted hover:bg-surface hover:text-brand">
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      ) : null}
      {verified === true ? (
        <span className="inline-flex items-center gap-0.5 text-caption text-ok-text">
          <Check aria-hidden="true" className="h-3.5 w-3.5" /> matches
        </span>
      ) : verified === false ? (
        <span className="inline-flex items-center gap-0.5 text-caption text-tampered-text">
          <X aria-hidden="true" className="h-3.5 w-3.5" /> mismatch
        </span>
      ) : null}
    </span>
  );
}