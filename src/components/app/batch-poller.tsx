"use client";

import { toast } from "sonner";
import { useBatchPolling } from "@/lib/ui/use-batch-polling";
import type { BatchStatus } from "@/types";

export interface BatchPollerProps {
  batchId: string;
  status: BatchStatus;
}

/** Client island for batch detail: polls while transient and announces status changes politely (P8). */
export function BatchPoller({ batchId, status }: BatchPollerProps) {
  const { polling, announcement } = useBatchPolling(batchId, status, {
    onOffline: () => toast.warning("You're offline — showing last loaded data"),
  });
  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="batch-live-region">
        {announcement}
      </div>
      {polling ? (
        <span className="inline-flex items-center gap-1.5 text-caption text-ink-muted" title="Refreshing every few seconds while the batch is processing">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-st-transient motion-safe:animate-pulse-dot" />
          auto-refresh
        </span>
      ) : null}
    </>
  );
}