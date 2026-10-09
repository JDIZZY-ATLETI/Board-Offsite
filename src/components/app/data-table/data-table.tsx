"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert } from "@/components/app/alert";
import { EmptyState, type EmptyStateProps } from "@/components/app/empty-state";
import { SkeletonLoader } from "@/components/app/skeleton-loader";
import { Pagination } from "./pagination";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right" | "center";
    mono?: boolean;
    width?: string;
    /** Hidden below the given priority breakpoint (tertiary columns). */
    priority?: "secondary" | "tertiary";
    headerTitle?: string;
  }
}

export type DataTableStatus = "idle" | "loading" | "error" | "empty";

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  rowId: (row: T) => string;
  caption: string;
  pagination?:
    | { mode: "cursor"; hasNext: boolean; hasPrev: boolean; onNext(): void; onPrev(): void; pageSize: number }
    | { mode: "client"; pageSize?: number };
  sorting?: { state: SortingState; onChange(s: SortingState): void } | "client" | "none";
  defaultSorting?: SortingState;
  filters?: React.ReactNode;
  toolbarEnd?: React.ReactNode;
  density?: "compact" | "comfortable";
  stickyHeader?: boolean;
  expandable?: { render(row: T): React.ReactNode; isExpandable?(row: T): boolean; singleOpen?: boolean };
  groupBy?: { getKey(row: T): string; renderHeader(key: string, rows: T[]): React.ReactNode; defaultCollapsed?: boolean; order?(a: string, b: string): number };
  state?: { status: DataTableStatus; error?: { message: string; retry?(): void }; stale?: boolean };
  emptyState: Omit<EmptyStateProps, "compact">;
  onRowClick?(row: T): void;
  rowClassName?(row: T): string | undefined;
  className?: string;
  "data-testid"?: string;
}

/**
 * Dense analyst table (P3) over TanStack Table v8. Keyboard: Tab into table, Up/Down rows, Enter opens,
 * Right/Left expand/collapse, Home/End, PageUp/PageDown paginate (docs/ux-design.md section 4.4 / 8.2).
 */
export function DataTable<T>({
  columns,
  data,
  rowId,
  caption,
  pagination,
  sorting = "client",
  defaultSorting = [],
  filters,
  toolbarEnd,
  density = "compact",
  stickyHeader = true,
  expandable,
  groupBy,
  state = { status: "idle" },
  emptyState,
  onRowClick,
  rowClassName,
  className,
  ...rest
}: DataTableProps<T>) {
  const [clientSorting, setClientSorting] = React.useState<SortingState>(defaultSorting);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({});
  const [focusIndex, setFocusIndex] = React.useState(0);
  const rowRefs = React.useRef<Array<HTMLTableRowElement | null>>([]);

  const sortingState = sorting === "client" || sorting === "none" ? clientSorting : sorting.state;
  const onSortingChange = sorting === "client" || sorting === "none" ? setClientSorting : sorting.onChange;
  const manualSorting = sorting !== "client";

  const table = useReactTable<T>({
    data,
    columns,
    getRowId: (row) => rowId(row),
    state: { sorting: sortingState, expanded },
    onSortingChange: (u) => onSortingChange(typeof u === "function" ? u(sortingState) : u),
    onExpandedChange: (u) => setExpanded((prev) => (typeof u === "function" ? (u(prev) as Record<string, boolean>) : (u as Record<string, boolean>))),
    manualSorting,
    enableSorting: sorting !== "none",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getExpandedRowModel: expandable ? getExpandedRowModel() : undefined,
    getRowCanExpand: expandable ? (row) => expandable.isExpandable?.(row.original) ?? true : undefined,
    getPaginationRowModel: pagination?.mode === "client" ? getPaginationRowModel() : undefined,
    initialState: pagination?.mode === "client" ? { pagination: { pageSize: pagination.pageSize ?? 50 } } : undefined,
  });

  const rows = table.getRowModel().rows;
  const status: DataTableStatus = state.status === "idle" && rows.length === 0 ? "empty" : state.status;

  // Group rendering: ordered groups of row-model rows.
  const groups = React.useMemo(() => {
    if (!groupBy) return null;
    const m = new Map<string, Row<T>[]>();
    for (const r of rows) {
      const k = groupBy.getKey(r.original);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    const keys = [...m.keys()];
    if (groupBy.order) keys.sort(groupBy.order);
    return keys.map((k) => ({ key: k, rows: m.get(k)! }));
  }, [groupBy, rows]);

  const visibleRows: Row<T>[] = React.useMemo(() => {
    if (!groups) return rows;
    return groups.flatMap((g) => (collapsedGroups[g.key] ?? groupBy?.defaultCollapsed ? [] : g.rows));
  }, [groups, rows, collapsedGroups, groupBy?.defaultCollapsed]);

  React.useEffect(() => {
    if (focusIndex > visibleRows.length - 1) setFocusIndex(Math.max(0, visibleRows.length - 1));
  }, [visibleRows.length, focusIndex]);

  const focusRow = (i: number) => {
    const clamped = Math.max(0, Math.min(visibleRows.length - 1, i));
    setFocusIndex(clamped);
    rowRefs.current[clamped]?.focus();
  };

  const toggleExpand = (row: Row<T>, open?: boolean) => {
    if (!expandable || !row.getCanExpand()) return;
    const next = open ?? !row.getIsExpanded();
    if (expandable.singleOpen) setExpanded(next ? { [row.id]: true } : {});
    else row.toggleExpanded(next);
  };

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, row: Row<T>, i: number) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(i - 1);
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(visibleRows.length - 1);
        break;
      case "ArrowRight":
        if (expandable) {
          e.preventDefault();
          toggleExpand(row, true);
        }
        break;
      case "ArrowLeft":
        if (expandable) {
          e.preventDefault();
          toggleExpand(row, false);
        }
        break;
      case "Enter":
      case " ":
        if ((e.target as HTMLElement).tagName === "BUTTON" || (e.target as HTMLElement).tagName === "A") return;
        e.preventDefault();
        if (onRowClick) onRowClick(row.original);
        else toggleExpand(row);
        break;
      case "PageDown":
        if (pagination?.mode === "cursor" && pagination.hasNext) {
          e.preventDefault();
          pagination.onNext();
        } else if (pagination?.mode === "client" && table.getCanNextPage()) {
          e.preventDefault();
          table.nextPage();
        }
        break;
      case "PageUp":
        if (pagination?.mode === "cursor" && pagination.hasPrev) {
          e.preventDefault();
          pagination.onPrev();
        } else if (pagination?.mode === "client" && table.getCanPreviousPage()) {
          e.preventDefault();
          table.previousPage();
        }
        break;
      default:
        return;
    }
  };

  const colCount = table.getVisibleLeafColumns().length + (expandable ? 1 : 0);
  const cellPad = density === "compact" ? "px-3 py-2" : "px-4 py-3";
  const interactive = Boolean(onRowClick || expandable);

  const renderRow = (row: Row<T>, i: number) => {
    const expandedNow = expandable ? row.getIsExpanded() : false;
    const canExpand = expandable ? row.getCanExpand() : false;
    const panelId = `${row.id}-panel`;
    return (
      <React.Fragment key={row.id}>
        <TableRow
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          tabIndex={i === focusIndex ? 0 : -1}
          data-row-id={row.id}
          data-state={expandedNow ? "expanded" : undefined}
          aria-expanded={expandable && canExpand ? expandedNow : undefined}
          onKeyDown={(e) => onRowKeyDown(e, row, i)}
          onFocus={() => setFocusIndex(i)}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("button, a, input, [role=menuitem]")) return;
            if (onRowClick) onRowClick(row.original);
            else toggleExpand(row);
          }}
          className={cn(interactive && "cursor-pointer", density === "compact" ? "h-10" : "h-12", rowClassName?.(row.original))}
        >
          {expandable ? (
            <TableCell className={cn("w-8", cellPad, "pr-0")}>
              {canExpand ? (
                <button
                  type="button"
                  aria-expanded={expandedNow}
                  aria-controls={panelId}
                  aria-label={expandedNow ? "Collapse row" : "Expand row"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(row);
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-muted hover:bg-surface hover:text-ink"
                >
                  {expandedNow ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                </button>
              ) : null}
            </TableCell>
          ) : null}
          {row.getVisibleCells().map((cell) => {
            const meta = cell.column.columnDef.meta;
            return (
              <TableCell
                key={cell.id}
                className={cn(cellPad, meta?.align === "right" && "text-right tabular-nums", meta?.align === "center" && "text-center", meta?.mono && "font-mono text-caption", meta?.priority === "tertiary" && "hidden xl:table-cell", meta?.priority === "secondary" && "hidden lg:table-cell")}
                style={meta?.width ? { width: meta.width } : undefined}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            );
          })}
        </TableRow>
        {expandable && expandedNow ? (
          <tr id={panelId} role="region" aria-label="Row details" className="border-b border-border bg-surface/60">
            <td colSpan={colCount} className="p-4">
              {expandable.render(row.original)}
            </td>
          </tr>
        ) : null}
      </React.Fragment>
    );
  };

  let bodyIndex = 0;

  return (
    <div className={cn("flex flex-col rounded-md border border-border bg-surface-raised shadow-card", className)} data-testid={rest["data-testid"]}>
      {filters || toolbarEnd ? (
        <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-border p-3", status === "loading" && "pointer-events-none opacity-60")} aria-disabled={status === "loading"}>
          <div className="min-w-0 flex-1">{filters}</div>
          {toolbarEnd ? <div className="flex items-center gap-2">{toolbarEnd}</div> : null}
        </div>
      ) : null}
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={caption} aria-busy={status === "loading"}>
        <Table className={cn(state.stale && "opacity-60")}>
          <TableCaption>{caption}</TableCaption>
          <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-surface-raised shadow-[inset_0_-1px_0_0_hsl(var(--border))]")}>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {expandable ? <TableHead className="w-8" aria-label="Expand" /> : null}
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const canSort = header.column.getCanSort() && sorting !== "none";
                  const dir = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : canSort ? "none" : undefined}
                      title={meta?.headerTitle}
                      className={cn(density === "compact" ? "h-10 px-3" : "h-12 px-4", meta?.align === "right" && "text-right", meta?.align === "center" && "text-center", meta?.priority === "tertiary" && "hidden xl:table-cell", meta?.priority === "secondary" && "hidden lg:table-cell")}
                      style={meta?.width ? { width: meta.width } : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          onKeyDown={(e) => {
                            if (e.key === "S" && e.shiftKey) header.column.toggleSorting();
                          }}
                          className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink", meta?.align === "right" && "flex-row-reverse")}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === "asc" ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /> : dir === "desc" ? <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {status === "loading" && rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <SkeletonLoader variant="table-rows" n={8} />
                </td>
              </tr>
            ) : status === "error" && rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-4">
                  <Alert
                    variant="error"
                    title="Couldn't load this table"
                    actions={
                      state.error?.retry ? (
                        <Button size="sm" variant="outline" onClick={state.error.retry}>
                          <RefreshCw aria-hidden="true" /> Retry
                        </Button>
                      ) : null
                    }
                  >
                    {state.error?.message}
                  </Alert>
                </td>
              </tr>
            ) : status === "empty" ? (
              <tr>
                <td colSpan={colCount}>
                  <EmptyState compact {...emptyState} />
                </td>
              </tr>
            ) : groups ? (
              groups.map((g) => {
                const collapsed = collapsedGroups[g.key] ?? groupBy?.defaultCollapsed ?? false;
                return (
                  <React.Fragment key={g.key}>
                    <tr className="border-b border-border bg-surface">
                      <th scope="rowgroup" colSpan={colCount} className="px-3 py-2 text-left text-h3 font-semibold text-ink">
                        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsedGroups((s) => ({ ...s, [g.key]: !collapsed }))} className="flex w-full items-center gap-2 rounded-sm text-left">
                          {collapsed ? <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-muted" /> : <ChevronDown aria-hidden="true" className="h-4 w-4 text-ink-muted" />}
                          <span className="flex min-w-0 flex-1 items-center gap-2">{groupBy!.renderHeader(g.key, g.rows.map((r) => r.original))}</span>
                        </button>
                      </th>
                    </tr>
                    {!collapsed ? g.rows.map((r) => renderRow(r, bodyIndex++)) : null}
                  </React.Fragment>
                );
              })
            ) : (
              rows.map((r, i) => renderRow(r, i))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination?.mode === "cursor" ? (
        <Pagination mode="cursor" shown={data.length} hasNext={pagination.hasNext} hasPrev={pagination.hasPrev} onNext={pagination.onNext} onPrev={pagination.onPrev} pageSize={pagination.pageSize} />
      ) : pagination?.mode === "client" && data.length > (pagination.pageSize ?? 50) ? (
        <Pagination mode="client" pageIndex={table.getState().pagination.pageIndex} pageCount={table.getPageCount()} pageSize={table.getState().pagination.pageSize} total={data.length} onPageChange={(i) => table.setPageIndex(i)} />
      ) : null}
    </div>
  );
}