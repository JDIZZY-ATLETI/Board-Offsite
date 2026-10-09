"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { actorLabel, formatInt, formatUtcIso, shortBatchId, shortId } from "@/lib/ui/format";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/app/copy-button";
import { HashChip } from "./hash-chip";
import type { LedgerEntry } from "@/types";

export interface LedgerEntryCardProps {
  entry: LedgerEntry;
  recomputed?: { payloadHash: string; entryHash: string; matches: boolean } | null;
  variant: "row" | "full";
  className?: string;
}

export function streamLabel(streamId: string): { kind: "batch" | "member" | "system" | "other"; short: string } {
  if (streamId === "system") return { kind: "system", short: "system" };
  if (streamId.startsWith("batch:")) return { kind: "batch", short: `batch:${shortBatchId(streamId.slice(6))}` };
  if (streamId.startsWith("member:")) return { kind: "member", short: `member:…${streamId.slice(-4)}` };
  return { kind: "other", short: shortId(streamId) };
}

/** docs/ux-design.md section 4.12. Payload is pseudonymised by construction; never shows a raw SIN. */
export function LedgerEntryCard({ entry, recomputed, variant, className }: LedgerEntryCardProps) {
  const stream = streamLabel(entry.streamId);
  const json = React.useMemo(() => JSON.stringify(entry.payload, null, 2), [entry.payload]);
  const download = () => {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-entry-${entry.seq}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className={cn("space-y-4", className)}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
        <dt className="text-ink-muted">Seq</dt>
        <dd className="font-mono tabular-nums">#{formatInt(entry.seq)}</dd>
        <dt className="text-ink-muted">Event</dt>
        <dd className="font-medium">{entry.eventType}</dd>
        <dt className="text-ink-muted">Stream</dt>
        <dd className="flex items-center gap-1 font-mono text-caption">
          <span title={entry.streamId}>{stream.short}</span>
          <span className="text-ink-muted">(#{entry.streamSeq})</span>
          <CopyButton value={entry.streamId} label="Copy stream id" />
        </dd>
        <dt className="text-ink-muted">Batch</dt>
        <dd className="font-mono text-caption">
          {entry.batchId ? (
            <Link href={`/batches/${entry.batchId}`} className="text-brand hover:underline" title={entry.batchId}>
              {shortBatchId(entry.batchId)}
            </Link>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </dd>
        <dt className="text-ink-muted">Occurred (UTC)</dt>
        <dd className="font-mono text-caption tabular-nums">{formatUtcIso(entry.occurredAt)}</dd>
        <dt className="text-ink-muted">Actor</dt>
        <dd className="font-mono text-caption" title={entry.actor}>
          {actorLabel(entry.actor)}
        </dd>
        <dt className="text-ink-muted">Entry id</dt>
        <dd className="font-mono text-caption">{entry.entryId}</dd>
      </dl>
      <div className="grid gap-2 rounded-md border border-border bg-surface p-3">
        <HashChip hash={entry.entryHash} label="entryHash" truncate={12} verified={recomputed ? recomputed.entryHash === entry.entryHash : null} />
        <HashChip hash={entry.payloadHash} label="payloadHash" truncate={12} verified={recomputed ? recomputed.payloadHash === entry.payloadHash : null} />
        <HashChip hash={entry.prevHashGlobal} label="prevGlobal" truncate={12} href={entry.seq > 1 ? `/ledger?seq=${entry.seq - 1}` : undefined} />
        <HashChip hash={entry.prevHashStream} label="prevStream" truncate={12} />
        {recomputed ? (
          <p className={cn("text-caption", recomputed.matches ? "text-ok-text" : "text-tampered-text")}>{recomputed.matches ? "Recomputed on open: payloadHash ✓ entryHash ✓" : "Recomputed on open: hash mismatch — this entry does not verify"}</p>
        ) : null}
      </div>
      <details open={variant === "full"} className="group rounded-md border border-border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-small font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-90" />
          Payload (JSON)
          <span className="ml-auto flex items-center gap-1">
            <CopyButton value={json} label="Copy payload JSON" size="sm" />
            <Button variant="ghost" size="icon" aria-label="Download entry as .json" onClick={(e) => { e.preventDefault(); download(); }}>
              <Download aria-hidden="true" />
            </Button>
          </span>
        </summary>
        <pre className="max-h-96 overflow-auto border-t border-border bg-surface p-3 font-mono text-caption leading-relaxed text-ink">{json}</pre>
      </details>
    </div>
  );
}