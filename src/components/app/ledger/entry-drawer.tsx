"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SkeletonLoader } from "@/components/app/skeleton-loader";
import { Alert } from "@/components/app/alert";
import { formatInt } from "@/lib/ui/format";
import { LedgerEntryCard } from "./ledger-entry-card";
import type { LedgerEntry } from "@/types";

type Loaded = LedgerEntry & { recomputed: { payloadHash: string; entryHash: string; matches: boolean } };

export interface EntryDrawerProps {
  headSeq: number;
}

/** Right drawer bound to `?seq=`; Alt+Left/Right walks the global chain (section 8.2). */
export function EntryDrawer({ headSeq }: EntryDrawerProps) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const seqParam = sp.get("seq");
  const seq = seqParam ? Number(seqParam) : null;
  const [entry, setEntry] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const go = React.useCallback(
    (next: number | null) => {
      const q = new URLSearchParams(sp.toString());
      if (next === null) q.delete("seq");
      else q.set("seq", String(next));
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [pathname, router, sp],
  );

  React.useEffect(() => {
    if (!seq || !Number.isInteger(seq)) {
      setEntry(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/ledger/entries/${seq}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? `No entry #${formatInt(seq)}` : `HTTP ${r.status}`);
        return (await r.json()) as Loaded;
      })
      .then((e) => {
        if (!cancelled) setEntry(e);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [seq]);

  React.useEffect(() => {
    if (!seq) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowLeft" && seq > 1) go(seq - 1);
      if (e.key === "ArrowRight" && seq < headSeq) go(seq + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seq, headSeq, go]);

  const open = seq !== null && Number.isInteger(seq);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && go(null)}>
      <SheetContent side="right" className="overflow-y-auto" aria-describedby="entry-drawer-desc" data-testid="entry-drawer">
        <SheetHeader>
          <SheetTitle>Ledger entry #{seq ? formatInt(seq) : ""}</SheetTitle>
          <SheetDescription id="entry-drawer-desc">{entry ? entry.eventType : "Hash-chained entry details"}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-1 px-6">
          <Button variant="outline" size="sm" onClick={() => seq && go(seq - 1)} disabled={!seq || seq <= 1} aria-label="Previous global entry (Alt+Left)" title="Alt+Left">
            <ChevronLeft aria-hidden="true" /> Previous global
          </Button>
          <Button variant="outline" size="sm" onClick={() => seq && go(seq + 1)} disabled={!seq || seq >= headSeq} aria-label="Next global entry (Alt+Right)" title="Alt+Right">
            Next global <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="px-6 pb-6">
          {loading && !entry ? <SkeletonLoader variant="drawer" className="p-0" /> : error ? <Alert variant="error" title="Couldn't load this entry">{error}</Alert> : entry ? <LedgerEntryCard entry={entry} recomputed={entry.recomputed} variant="full" /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}