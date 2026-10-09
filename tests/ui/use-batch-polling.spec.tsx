// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchStatus } from "@/types";

const refresh = vi.fn();
const router = { refresh, push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { POLL_BACKOFF_AFTER_MS, POLL_BACKOFF_INTERVAL_MS, POLL_INTERVAL_MS, useBatchPolling } from "@/lib/ui/use-batch-polling";

function fetcherReturning(statuses: BatchStatus[]) {
  let i = 0;
  const fn = vi.fn(async () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return new Response(JSON.stringify({ status }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return fn;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useBatchPolling (section 9.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 3 s while transient and refreshes on change, then stops on a non-transient status", async () => {
    const fetcher = fetcherReturning(["RECEIVED", "PARSED", "VALIDATED"]);
    const { result } = renderHook(() => useBatchPolling("b1", "RECEIVED", { fetcher }));
    expect(result.current.polling).toBe(true);
    await advance(POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(0);
    await advance(POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.announcement).toBe("Batch is now Parsed");
    await advance(POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.announcement).toBe("Batch is now Validated");
    expect(result.current.polling).toBe(false);
    await advance(POLL_INTERVAL_MS * 5);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not poll for terminal statuses", async () => {
    const fetcher = fetcherReturning(["FILE_REJECTED"]);
    const { result } = renderHook(() => useBatchPolling("b1", "FILE_REJECTED", { fetcher }));
    expect(result.current.polling).toBe(false);
    await advance(POLL_INTERVAL_MS * 3);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("backs off to 10 s after 2 minutes", async () => {
    const fetcher = fetcherReturning(["RECEIVED"]);
    renderHook(() => useBatchPolling("b1", "RECEIVED", { fetcher }));
    await advance(POLL_BACKOFF_AFTER_MS);
    const before = fetcher.mock.calls.length;
    expect(before).toBe(POLL_BACKOFF_AFTER_MS / POLL_INTERVAL_MS);
    await advance(POLL_INTERVAL_MS);
    expect(fetcher.mock.calls.length).toBe(before);
    await advance(POLL_BACKOFF_INTERVAL_MS - POLL_INTERVAL_MS);
    expect(fetcher.mock.calls.length).toBe(before + 1);
  });

  it("pauses while the document is hidden and resumes when visible", async () => {
    const fetcher = fetcherReturning(["RECEIVED"]);
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    renderHook(() => useBatchPolling("b1", "RECEIVED", { fetcher }));
    await advance(POLL_INTERVAL_MS * 3);
    expect(fetcher).not.toHaveBeenCalled();
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports offline after two consecutive failures", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network");
    });
    const onOffline = vi.fn();
    renderHook(() => useBatchPolling("b1", "RECEIVED", { fetcher, onOffline }));
    await advance(POLL_INTERVAL_MS);
    expect(onOffline).not.toHaveBeenCalled();
    await advance(POLL_INTERVAL_MS);
    expect(onOffline).toHaveBeenCalledTimes(1);
  });
});