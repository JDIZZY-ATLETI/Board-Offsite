"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { isTransientStatus } from "@/lib/ui/status-map";
import type { BatchStatus } from "@/types";

export const POLL_INTERVAL_MS = 3_000;
export const POLL_BACKOFF_AFTER_MS = 120_000;
export const POLL_BACKOFF_INTERVAL_MS = 10_000;

export interface UseBatchPollingOptions {
  /** Override transient detection (batches list: "any transient visible"). */
  active?: boolean;
  /** Called with the fresh status when it differs from the one rendered. Defaults to router.refresh(). */
  onChange?(next: BatchStatus, prev: BatchStatus | null): void;
  /** Called after two consecutive network failures (offline toast). */
  onOffline?(): void;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface BatchPollingState {
  polling: boolean;
  lastStatus: BatchStatus | null;
  lastCheckedAt: number | null;
  /** Polite live-region text ("Batch is now Validated"). */
  announcement: string;
}

/**
 * docs/ux-design.md section 9.4: poll GET /api/batches/{id} every 3 s while transient, back off to 10 s after
 * 2 min, stop on non-transient; pause while document.hidden; router.refresh() on change.
 */
export function useBatchPolling(batchId: string | null, status: BatchStatus | null, opts: UseBatchPollingOptions = {}): BatchPollingState {
  const router = useRouter();
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const [state, setState] = React.useState<BatchPollingState>({ polling: false, lastStatus: status, lastCheckedAt: null, announcement: "" });
  const optsRef = React.useRef(opts);
  optsRef.current = opts;
  const statusRef = React.useRef<BatchStatus | null>(status);
  statusRef.current = status;

  const active = opts.active ?? (status !== null && isTransientStatus(status));

  React.useEffect(() => {
    if (!active || !batchId) {
      setState((s) => (s.polling ? { ...s, polling: false } : s));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const startedAt = Date.now();
    const fetcher = optsRef.current.fetcher ?? fetch;

    const schedule = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const interval = elapsed >= POLL_BACKOFF_AFTER_MS ? POLL_BACKOFF_INTERVAL_MS : POLL_INTERVAL_MS;
      timer = setTimeout(tick, interval);
    };

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const res = await fetcher(`/api/batches/${batchId}`, { headers: { accept: "application/json" }, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { status: BatchStatus };
        failures = 0;
        if (cancelled) return;
        const prev = statusRef.current;
        setState((s) => ({ ...s, lastCheckedAt: Date.now(), lastStatus: body.status }));
        if (body.status !== prev) {
          statusRef.current = body.status;
          const label = body.status.replace(/_/g, " ").toLowerCase();
          setState((s) => ({ ...s, announcement: `Batch is now ${label.charAt(0).toUpperCase()}${label.slice(1)}` }));
          if (optsRef.current.onChange) optsRef.current.onChange(body.status, prev);
          else routerRef.current.refresh();
          if (!isTransientStatus(body.status) && optsRef.current.active === undefined) {
            setState((s) => ({ ...s, polling: false }));
            return;
          }
        }
      } catch {
        failures += 1;
        if (failures === 2) optsRef.current.onOffline?.();
      }
      schedule();
    };

    setState((s) => ({ ...s, polling: true }));
    schedule();

    const onVisible = () => {
      if (!document.hidden && !cancelled) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(tick, 0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, batchId]);

  return state;
}