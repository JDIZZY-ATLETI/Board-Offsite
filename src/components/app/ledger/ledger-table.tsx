"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/app/data-table/data-table";
import { FacetSelect } from "@/components/app/data-table/facet-select";
import { FilterBar, useUrlFilters } from "@/components/app/data-table/filter-bar";
import { actorLabel, formatInt, formatUtcIso, shortBatchId, shortHash } from "@/lib/ui/format";
import { LEDGER_EVENT_TYPES, type LedgerEntry } from "@/types";
import { CopyButton } from "@/components/app/copy-button";
import { streamLabel } from "./ledger-entry-card";

export interface LedgerTableProps {
  entries: LedgerEntry[];
  nextCursor: string | null;
  prevCursors: string[];
  /** Highlights rows at or after the first bad seq (verification failure). */
  firstBadSeq?: number | null;
  /** Hide the batch filter when already scoped to a batch. */
  batchScoped?: boolean;
}

/** docs/ux-design.md section 5.6. Row click opens the entry drawer via `?seq=`. */
export function LedgerTable({ entries, nextCursor, prevCursors, firstBadSeq = null, batchScoped = false }: LedgerTableProps) {
  const url = useUrlFilters();
  const stream = url.get("stream");
  const eventType = url.getList("eventType");
  const batchId = url.get("batchId");
  const fromSeq = url.get("fromSeq");
  const toSeq = url.get("toSeq");
  const [range, setRange] = React.useState({ from: fromSeq, to: toSeq });
  React.useEffect(() => setRange({ from: fromSeq, to: toSeq }), [fromSeq, toSeq]);

  const columns: ColumnDef<LedgerEntry, unknown>[] = [
    { id: "seq", header: "Seq", accessorKey: "seq", cell: ({ getValue }) => <span className="font-mono tabular-nums">{formatInt(getValue() as number)}</span>, meta: { align: "right", width: "5.5rem" } },
    { id: "occurredAt", header: "Occurred (UTC)", accessorKey: "occurredAt", cell: ({ getValue }) => <span className="font-mono text-caption tabular-nums">{formatUtcIso(getValue() as string)}</span>, meta: { width: "15rem" } },
    { id: "eventType", header: "Event type", accessorKey: "eventType", cell: ({ getValue }) => <span className="font-medium">{String(getValue())}</span> },
    {
      id: "stream",
      header: "Stream",
      accessorKey: "streamId",
      cell: ({ row }) => {
        const s = streamLabel(row.original.streamId);
        return (
          <span className="font-mono text-caption" title={row.original.streamId}>
            {s.short} <span className="text-ink-muted">(#{row.original.streamSeq})</span>
          </span>
        );
      },
    },
    {
      id: "batch",
      header: "Batch",
      accessorKey: "batchId",
      cell: ({ getValue }) => {
        const b = getValue() as string | null;
        return b ? (
          <Link href={`/batches/${b}`} className="font-mono text-caption text-brand hover:underline" title={b} onClick={(e) => e.stopPropagation()}>
            {shortBatchId(b)}
          </Link>
        ) : (
          <span className="text-ink-faint">—</span>
        );
      },
      meta: { width: "8rem" },
    },
    { id: "actor", header: "Actor", accessorKey: "actor", cell: ({ getValue }) => <span className="font-mono text-caption" title={String(getValue())}>{actorLabel(String(getValue()))}</span>, meta: { priority: "tertiary", width: "8rem" } },
    {
      id: "hash",
      header: "Hash",
      accessorKey: "entryHash",
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="inline-flex items-center gap-1">
          <code className="font-mono text-caption" title={String(getValue())}>
            {shortHash(String(getValue()))}
          </code>
          <CopyButton value={String(getValue())} label="Copy full hash" />
        </span>
      ),
      meta: { width: "10rem" },
    },
  ];

  const chips = [
    ...(stream ? [{ key: "stream", label: `Stream: ${stream}`, onRemove: () => url.set({ stream: null }) }] : []),
    ...eventType.map((e) => ({ key: `et-${e}`, label: e, onRemove: () => url.set({ eventType: eventType.filter((x) => x !== e) }) })),
    ...(batchId && !batchScoped ? [{ key: "batch", label: `Batch: ${shortBatchId(batchId)}`, onRemove: () => url.set({ batchId: null }) }] : []),
    ...(fromSeq || toSeq ? [{ key: "range", label: `Seq ${fromSeq || "1"}–${toSeq || "head"}`, onRemove: () => url.set({ fromSeq: null, toSeq: null }) }] : []),
  ];

  const applyRange = () => url.set({ fromSeq: range.from || null, toSeq: range.to || null });

  return (
    <DataTable<LedgerEntry>
      data-testid="ledger-table"
      caption="Ledger entries, newest first"
      columns={columns}
      data={entries}
      rowId={(e) => String(e.seq)}
      sorting="none"
      onRowClick={(e) => url.set({ seq: String(e.seq) }, { resetCursor: false })}
      rowClassName={(e) => (firstBadSeq !== null && e.seq >= firstBadSeq ? (e.seq === firstBadSeq ? "bg-tampered-soft" : "bg-tampered-soft/40") : undefined)}
      filters={
        <FilterBar chips={chips} onClear={() => url.clear(batchScoped ? ["batchId"] : [])}>
          <FacetSelect
            label="Stream"
            single
            options={[
              { value: "batch", label: "Batch streams" },
              { value: "member", label: "Member streams" },
              { value: "system", label: "System" },
            ]}
            value={stream ? [stream] : []}
            onChange={(v) => url.set({ stream: v[0] ?? null })}
          />
          <FacetSelect label="Event type" options={LEDGER_EVENT_TYPES.map((e) => ({ value: e, label: e }))} value={eventType} onChange={(v) => url.set({ eventType: v })} />
          {!batchScoped ? <Input aria-label="Batch id" placeholder="Batch id" defaultValue={batchId} onBlur={(e) => url.set({ batchId: e.target.value.trim() || null })} onKeyDown={(e) => e.key === "Enter" && url.set({ batchId: (e.target as HTMLInputElement).value.trim() || null })} className="h-8 w-72 font-mono text-caption" /> : null}
          <div className="flex items-center gap-1">
            <Input aria-label="From seq" placeholder="from" inputMode="numeric" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value.replace(/\D/g, "") }))} onKeyDown={(e) => e.key === "Enter" && applyRange()} className="h-8 w-20 text-small" />
            <span className="text-ink-faint">–</span>
            <Input aria-label="To seq" placeholder="to" inputMode="numeric" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value.replace(/\D/g, "") }))} onKeyDown={(e) => e.key === "Enter" && applyRange()} className="h-8 w-20 text-small" />
            <Button variant="outline" size="sm" onClick={applyRange}>
              Apply
            </Button>
          </div>
        </FilterBar>
      }
      pagination={{
        mode: "cursor",
        hasNext: nextCursor !== null,
        hasPrev: prevCursors.length > 0,
        pageSize: 50,
        onNext: () => nextCursor && url.set({ cursor: nextCursor, prev: [...prevCursors, url.get("cursor") || ""].join("|") }, { resetCursor: false }),
        onPrev: () => {
          const stack = [...prevCursors];
          const back = stack.pop() ?? "";
          url.set({ cursor: back || null, prev: stack.length ? stack.join("|") : null }, { resetCursor: false });
        },
      }}
      emptyState={chips.length ? { title: "No entries match", description: "Widen the stream, event type or sequence range.", illustration: "search" } : { title: "The ledger is empty", description: "The first entry is written when a file is received.", illustration: "inbox" }}
    />
  );
}