"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Ellipsis, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { BatchSummary } from "@/lib/queries/batches";
import { formatDateTime, formatInt, shortBatchId } from "@/lib/ui/format";
import { BATCH_STATUS_MAP, isTransientStatus } from "@/lib/ui/status-map";
import { useBatchPolling } from "@/lib/ui/use-batch-polling";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/app/badges/status-badge";
import { CopyButton } from "@/components/app/copy-button";
import { DataTable } from "@/components/app/data-table/data-table";
import { FacetSelect } from "@/components/app/data-table/facet-select";
import { FilterBar, useUrlFilters } from "@/components/app/data-table/filter-bar";
import { RejectedCsvDialog } from "@/components/app/findings/rejected-csv-button";
import { BATCH_STATUSES, type BatchStatus, type Role } from "@/types";

export interface BatchesTableLiveProps {
  batches: BatchSummary[];
  nextCursor: string | null;
  prevCursors: string[];
  role: Role;
  showEmployer: boolean;
}

const SAVED_VIEWS: Array<{ key: string; label: string; params: Record<string, string | null> }> = [
  { key: "all", label: "All", params: { status: null } },
  { key: "pending", label: "Pending approval", params: { status: "PENDING_APPROVAL" } },
  { key: "rejected", label: "File rejected", params: { status: "FILE_REJECTED" } },
  { key: "done", label: "Validated", params: { status: "VALIDATED" } },
];

/** Batches list with URL filters and the "(auto)" polling island (docs/ux-design.md section 5.3). */
export function BatchesTableLive({ batches, nextCursor, prevCursors, role, showEmployer }: BatchesTableLiveProps) {
  const url = useUrlFilters();
  const router = useRouter();
  const status = url.get("status");
  const employer = url.get("employerId");
  const q = url.get("q");
  const anyTransient = batches.some((b) => isTransientStatus(b.status));
  const { polling } = useBatchPolling(anyTransient ? batches.find((b) => isTransientStatus(b.status))!.batchId : null, null, {
    active: anyTransient,
    onChange: () => router.refresh(),
    onOffline: () => toast.warning("You're offline — showing last loaded data"),
  });

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return batches;
    return batches.filter((b) => b.batchId.replace(/-/g, "").startsWith(needle.replace(/-/g, "")) || b.originalFilename.toLowerCase().includes(needle));
  }, [batches, q]);

  const columns: ColumnDef<BatchSummary, unknown>[] = [
    {
      id: "receivedAt",
      header: "Received",
      accessorKey: "receivedAt",
      cell: ({ getValue }) => (
        <time dateTime={String(getValue())} title={formatDateTime(String(getValue()), { seconds: true })} className="tabular-nums">
          {formatDateTime(String(getValue()))}
        </time>
      ),
      meta: { width: "10rem" },
    },
    {
      id: "batch",
      header: "Batch",
      accessorKey: "batchId",
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="inline-flex items-center gap-1">
          <Link href={`/batches/${getValue()}`} className="font-mono text-caption text-brand hover:underline" title={String(getValue())} onClick={(e) => e.stopPropagation()}>
            {shortBatchId(String(getValue()))}
          </Link>
          <CopyButton value={String(getValue())} label="Copy batch id" />
        </span>
      ),
      meta: { width: "9rem" },
    },
    ...(showEmployer ? [{ id: "employer", header: "Employer", accessorKey: "employerId", cell: ({ getValue }) => <span className="font-mono text-caption">{String(getValue())}</span>, meta: { width: "6rem" } } as ColumnDef<BatchSummary, unknown>] : []),
    { id: "file", header: "File", accessorKey: "originalFilename", cell: ({ getValue }) => <span className="block max-w-[16rem] truncate" title={String(getValue())}>{String(getValue())}</span> },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge status={row.original.status} heldCount={row.original.counts.held ?? 0} size="sm" />, meta: { width: "12rem" } },
    { id: "rows", header: "Rows", accessorFn: (b) => b.counts.rows, cell: ({ row }) => (row.original.counts.rows ? formatInt(row.original.counts.rows) : <span className="text-ink-faint">—</span>), meta: { align: "right", width: "5rem" } },
    { id: "accepted", header: "Acc", accessorFn: (b) => b.counts.accepted, cell: ({ row }) => (row.original.counts.rows ? formatInt(row.original.counts.accepted) : <span className="text-ink-faint">—</span>), meta: { align: "right", width: "5rem", headerTitle: "Accepted rows" } },
    { id: "rejected", header: "Rej", accessorFn: (b) => b.counts.rejected, cell: ({ row }) => (row.original.counts.rows ? <span className={cn(row.original.counts.rejected > 0 && "font-medium text-rejected-text")}>{formatInt(row.original.counts.rejected)}</span> : <span className="text-ink-faint">—</span>), meta: { align: "right", width: "5rem", headerTitle: "Rejected rows" } },
    { id: "warnings", header: "Warn", accessorFn: (b) => b.counts.warnings, cell: ({ row }) => (row.original.counts.rows ? <span className={cn((row.original.counts.held ?? 0) > 0 && "font-medium text-held-text")} title={row.original.counts.held ? `${formatInt(row.original.counts.held)} held row${row.original.counts.held === 1 ? "" : "s"} need an override` : undefined}>{formatInt(row.original.counts.warnings)}{row.original.counts.held ? <span className="text-caption"> · {formatInt(row.original.counts.held)} held</span> : null}</span> : <span className="text-ink-faint">—</span>), meta: { align: "right", width: "6.5rem", headerTitle: "Warnings (held rows)" } },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => <RowActions batch={row.original} role={role} />,
      meta: { width: "3rem", align: "right" },
    },
  ];

  const chips = [
    ...(status ? [{ key: "status", label: `Status: ${BATCH_STATUS_MAP[status as BatchStatus]?.label ?? status}`, onRemove: () => url.set({ status: null }) }] : []),
    ...(employer ? [{ key: "employer", label: `Employer: ${employer}`, onRemove: () => url.set({ employerId: null }) }] : []),
  ];

  return (
    <DataTable<BatchSummary>
      data-testid="batches-table"
      caption="Batches, newest first"
      columns={columns}
      data={filtered}
      rowId={(b) => b.batchId}
      sorting="client"
      onRowClick={(b) => router.push(`/batches/${b.batchId}`)}
      filters={
        <FilterBar search={{ placeholder: "Search batch id / filename…", value: q, onChange: (v) => url.set({ q: v }), "aria-label": "Search batches" }} chips={chips} onClear={() => url.clear()}>
          <FacetSelect label="Status" single options={BATCH_STATUSES.map((s) => ({ value: s, label: BATCH_STATUS_MAP[s].label }))} value={status ? [status] : []} onChange={(v) => url.set({ status: v[0] ?? null })} data-testid="facet-status" />
          {showEmployer ? (
            <input
              aria-label="Employer id"
              placeholder="Employer"
              defaultValue={employer}
              onBlur={(e) => url.set({ employerId: e.target.value.trim() || null })}
              onKeyDown={(e) => e.key === "Enter" && url.set({ employerId: (e.target as HTMLInputElement).value.trim() || null })}
              className="h-8 w-28 rounded-sm border border-border bg-surface-raised px-2 font-mono text-caption"
            />
          ) : null}
          <div className="flex items-center gap-1 pl-2 text-caption text-ink-muted">
            <span>Saved views:</span>
            {SAVED_VIEWS.filter((v) => role !== "EmployerSubmitter" || v.key !== "pending").map((v) => {
              const active = (v.params.status ?? "") === status;
              return (
                <button key={v.key} type="button" onClick={() => url.set(v.params)} aria-pressed={active} className={cn("rounded-sm px-1.5 py-0.5 hover:text-ink", active && "bg-brand-soft font-medium text-brand")}>
                  {v.label}
                </button>
              );
            })}
          </div>
        </FilterBar>
      }
      toolbarEnd={
        polling ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5 text-caption text-ink-muted" tabIndex={0}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-st-transient motion-safe:animate-pulse-dot" />
                (auto)
              </span>
            </TooltipTrigger>
            <TooltipContent>Refreshing every 3 s while a batch is processing; paused when this tab is hidden.</TooltipContent>
          </Tooltip>
        ) : null
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
      emptyState={
        chips.length || q
          ? { title: "No batches match these filters", description: "Try a wider date range or clear the status filter.", illustration: "search", action: <Button variant="outline" size="sm" onClick={() => url.clear()}>Clear filters</Button> }
          : role === "EmployerSubmitter"
            ? {
                title: "No Events files yet",
                description: "Upload a terminations, retirements or deaths file to get started.",
                illustration: "inbox",
                action: (
                  <Button asChild size="sm">
                    <Link href="/upload">
                      <Upload aria-hidden="true" /> Upload Events file
                    </Link>
                  </Button>
                ),
              }
            : { title: "No batches yet", description: "Employers haven't uploaded any Events files.", illustration: "inbox" }
      }
    />
  );
}

function RowActions({ batch, role }: { batch: BatchSummary; role: Role }) {
  const router = useRouter();
  const [rejectedOpen, setRejectedOpen] = React.useState(false);
  const retry = async () => {
    const res = await fetch(`/api/batches/${batch.batchId}/retry`, { method: "POST" });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      toast.error("Retry didn't start", { description: err?.error?.message ?? `HTTP ${res.status}` });
      return;
    }
    toast.success(`Batch ${shortBatchId(batch.batchId)} re-queued.`);
    router.refresh();
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for batch ${shortBatchId(batch.batchId)}`} onClick={(e) => e.stopPropagation()}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem asChild>
            <Link href={`/batches/${batch.batchId}`}>Open</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/batches/${batch.batchId}/findings`}>Open findings</Link>
          </DropdownMenuItem>
          {batch.counts.rejected > 0 ? <DropdownMenuItem onSelect={() => setRejectedOpen(true)}>Download rejected rows</DropdownMenuItem> : null}
          {role === "Admin" && batch.status === "FAILED" ? <DropdownMenuItem onSelect={retry}>Retry processing</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <RejectedCsvDialog batchId={batch.batchId} rejectedRows={batch.counts.rejected} open={rejectedOpen} onOpenChange={setRejectedOpen} />
    </>
  );
}
