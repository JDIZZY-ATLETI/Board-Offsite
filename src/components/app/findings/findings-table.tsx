"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERITY_MAP, SEVERITY_SHORT } from "@/lib/ui/status-map";
import { displayName, formatInt, initials as initialsOf } from "@/lib/ui/format";
import type { FindingFacets } from "@/lib/queries/findings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SeverityBadge } from "@/components/app/badges/severity-badge";
import { OutcomeBadge } from "@/components/app/badges/outcome-badge";
import { DataTable } from "@/components/app/data-table/data-table";
import { FacetSelect } from "@/components/app/data-table/facet-select";
import { FilterBar, useUrlFilters } from "@/components/app/data-table/filter-bar";
import { MaskedSIN } from "@/components/app/masked-sin";
import { EmptyState } from "@/components/app/empty-state";
import { FindingCard, type FindingRecordSummary } from "./finding-card";
import { RejectedCsvButton } from "./rejected-csv-button";
import type { FindingSeverity, Role, ValidationFinding } from "@/types";

export type GroupMode = "row" | "severity" | "rule";

export interface FindingsViewProps {
  batchId: string;
  findings: ValidationFinding[];
  /** Keyed by lineNumber. */
  records: Record<number, FindingRecordSummary>;
  facets: FindingFacets;
  role: Role;
  nextCursor: string | null;
  prevCursors: string[];
  rejectedRows: number;
  fileRejected: boolean;
  canSeePrivate: boolean;
}

const SEVERITY_ORDER: FindingSeverity[] = ["FILE_ERROR", "COMPLETE_MEMBER_ERROR", "WARNING", "INFORMATION"];

export function defaultGroupMode(role: Role): GroupMode {
  return role === "EmployerSubmitter" ? "row" : "severity";
}

/** docs/ux-design.md section 5.4.2 / 4.8. Submitter default = by row (D1), Reviewer = by severity. */
export function FindingsView({ batchId, findings, records, facets, role, nextCursor, prevCursors, rejectedRows, fileRejected, canSeePrivate }: FindingsViewProps) {
  const url = useUrlFilters();
  const group = (url.get("group") as GroupMode) || defaultGroupMode(role);
  const severity = url.getList("severity");
  const ruleId = url.getList("ruleId");
  const field = url.getList("field");
  const q = url.get("q");
  const showPrivate = url.get("visibility") !== "PUBLIC";

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return findings.filter((f) => {
      if (field.length && (!f.field || !field.includes(f.field))) return false;
      if (needle && !`${f.portalMessage} ${f.ruleId} ${f.messageId} ${f.field ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [findings, field, q]);

  const chips = [
    ...severity.map((s) => ({ key: `sev-${s}`, label: `Severity: ${SEVERITY_SHORT[s as FindingSeverity] ?? s}`, onRemove: () => url.set({ severity: severity.filter((x) => x !== s) }) })),
    ...ruleId.map((r) => ({ key: `rule-${r}`, label: `Rule: ${r}`, onRemove: () => url.set({ ruleId: ruleId.filter((x) => x !== r) }) })),
    ...field.map((f) => ({ key: `field-${f}`, label: `Field: ${f}`, onRemove: () => url.set({ field: field.filter((x) => x !== f) }) })),
  ];
  const hasFilters = chips.length > 0 || q !== "";

  const filters = (
    <FilterBar
      search={{ placeholder: "Search message…", value: q, onChange: (v) => url.set({ q: v }), "aria-label": "Search findings" }}
      chips={chips}
      onClear={() => url.clear(["group"])}
    >
      <FacetSelect label="Severity" single options={SEVERITY_ORDER.filter((s) => facets.bySeverity.some((b) => b.value === s)).map((s) => ({ value: s, label: SEVERITY_SHORT[s], count: facets.bySeverity.find((b) => b.value === s)?.count }))} value={severity} onChange={(v) => url.set({ severity: v })} data-testid="facet-severity" />
      <FacetSelect label="Rule" single options={facets.byRule.map((r) => ({ value: r.value, label: r.value, count: r.count }))} value={ruleId} onChange={(v) => url.set({ ruleId: v })} data-testid="facet-rule" />
      <FacetSelect label="Field" options={facets.byField.map((r) => ({ value: r.value, label: r.value, count: r.count }))} value={field} onChange={(v) => url.set({ field: v })} data-testid="facet-field" />
      {canSeePrivate ? (
        <div className="flex items-center gap-2 pl-1">
          <Checkbox id="show-private" checked={showPrivate} onCheckedChange={(c) => url.set({ visibility: c ? null : "PUBLIC" })} />
          <Label htmlFor="show-private" className="text-small font-normal text-ink-muted">
            Show HOOPP-internal
          </Label>
        </div>
      ) : null}
    </FilterBar>
  );

  const groupControl = (
    <div className="flex items-center gap-1 rounded-sm border border-border p-0.5" role="radiogroup" aria-label="Group by">
      {(["row", "severity", "rule"] as GroupMode[]).map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={group === g}
          onClick={() => url.set({ group: g }, { resetCursor: false })}
          className={cn("rounded-sm px-2 py-1 text-small capitalize", group === g ? "bg-brand-soft font-medium text-brand" : "text-ink-muted hover:text-ink")}
        >
          {g === "row" ? "Row" : g === "severity" ? "Severity" : "Rule"}
        </button>
      ))}
    </div>
  );

  const downloads = (
    <>
      {rejectedRows > 0 ? <RejectedCsvButton batchId={batchId} rejectedRows={rejectedRows} /> : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button variant="outline" size="sm" disabled>
              <Download aria-hidden="true" /> Summary of validations
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Available in a later phase</TooltipContent>
      </Tooltip>
    </>
  );

  const pagination = {
    mode: "cursor" as const,
    hasNext: nextCursor !== null,
    hasPrev: prevCursors.length > 0,
    pageSize: 200,
    onNext: () => {
      if (!nextCursor) return;
      const stack = [...prevCursors, url.get("cursor") || ""];
      url.set({ cursor: nextCursor, prev: stack.join("|") }, { resetCursor: false });
    },
    onPrev: () => {
      const stack = [...prevCursors];
      const back = stack.pop() ?? "";
      url.set({ cursor: back || null, prev: stack.length ? stack.join("|") : null }, { resetCursor: false });
    },
  };

  const emptyState = fileRejected
    ? { title: "File rejected", description: "Only file-level findings exist for this batch.", illustration: "none" as const }
    : hasFilters
      ? { title: "No findings match", description: "Adjust the severity or rule filter.", illustration: "search" as const, action: <Button variant="outline" size="sm" onClick={() => url.clear(["group"])}>Clear filters</Button> }
      : { title: "No findings", description: "Every row passed validation.", illustration: "shield" as const };

  if (group === "row") {
    return (
      <div className="space-y-3" data-testid="findings-table">
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-surface-raised p-3">
          <div className="min-w-0 flex-1">{filters}</div>
          <div className="flex flex-wrap items-center gap-2">
            {groupControl}
            {downloads}
          </div>
        </div>
        <RowGroups findings={filtered} records={records} emptyState={emptyState} />
        {nextCursor || prevCursors.length ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-3 py-2 text-small text-ink-muted">
            <span>
              Showing {formatInt(filtered.length)}
              {nextCursor ? " · more available" : ""}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={pagination.onPrev} disabled={!pagination.hasPrev}>
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={pagination.onNext} disabled={!pagination.hasNext}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const columns: ColumnDef<ValidationFinding, unknown>[] = [
    { id: "severity", header: "Severity", accessorKey: "severity", cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" short />, meta: { width: "9rem" } },
    { id: "row", header: "Row", accessorKey: "lineNumber", cell: ({ row }) => (row.original.lineNumber ? `#${row.original.lineNumber}` : "file"), meta: { align: "right", width: "4.5rem" } },
    {
      id: "member",
      header: "Member",
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original.lineNumber ? records[row.original.lineNumber] : null;
        return r?.sinMasked ? <MaskedSIN masked={r.sinMasked} initials={initialsOf(r.firstName, r.lastName)} /> : <span className="text-ink-faint">—</span>;
      },
      meta: { width: "11rem" },
    },
    {
      id: "field",
      header: "Field",
      accessorKey: "field",
      cell: ({ row }) =>
        row.original.field ? (
          <span className="inline-flex items-center gap-1">
            <code className="font-mono text-caption">{row.original.field}</code>
            {row.original.yearScope ? (
              <abbr title={row.original.yearScope === "CURRENT" ? "Current year" : "Previous year"} className="rounded-sm bg-surface px-1 text-[10px] font-medium text-ink-muted no-underline">
                {row.original.yearScope === "CURRENT" ? "CY" : "PY"}
              </abbr>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    { id: "message", header: "Portal message", accessorKey: "portalMessage", enableSorting: false, cell: ({ getValue }) => <span className="line-clamp-2 max-w-xl whitespace-normal">{String(getValue())}</span> },
    {
      id: "rule",
      header: "Rule",
      accessorKey: "ruleId",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-caption">{row.original.ruleId}</span>
          </TooltipTrigger>
          <TooltipContent>{SEVERITY_MAP[row.original.severity].label}</TooltipContent>
        </Tooltip>
      ),
      meta: { width: "10rem" },
    },
    { id: "msg", header: "Msg ID", accessorKey: "messageId", meta: { mono: true, width: "5rem", priority: "tertiary" } },
    {
      id: "override",
      header: "Override",
      enableSorting: false,
      cell: ({ row }) => (row.original.override ? <span className="text-caption text-ok-text">Overridden</span> : row.original.severity === "WARNING" ? <span className="text-caption text-held-text">pending</span> : <span className="text-ink-faint">—</span>),
      meta: { width: "6rem", priority: "secondary" },
    },
  ];

  const groupBy =
    group === "severity"
      ? {
          getKey: (f: ValidationFinding) => f.severity,
          order: (a: string, b: string) => SEVERITY_ORDER.indexOf(a as FindingSeverity) - SEVERITY_ORDER.indexOf(b as FindingSeverity),
          renderHeader: (k: string, rows: ValidationFinding[]) => <SeverityBadge severity={k as FindingSeverity} count={rows.length} />,
        }
      : {
          getKey: (f: ValidationFinding) => f.ruleId,
          renderHeader: (k: string, rows: ValidationFinding[]) => (
            <>
              <span className="font-mono">{k}</span>
              <SeverityBadge severity={rows[0].severity} size="sm" short />
              <span className="text-small font-normal text-ink-muted">{formatInt(rows.length)} finding{rows.length === 1 ? "" : "s"}</span>
            </>
          ),
        };

  return (
    <DataTable<ValidationFinding>
      data-testid="findings-table"
      caption="Validation findings"
      columns={columns}
      data={filtered}
      rowId={(f) => f.findingId}
      filters={filters}
      toolbarEnd={
        <>
          {groupControl}
          {downloads}
        </>
      }
      groupBy={groupBy}
      expandable={{ render: (f) => <FindingCard finding={f} record={f.lineNumber ? records[f.lineNumber] : null} /> }}
      pagination={pagination}
      sorting="client"
      emptyState={emptyState}
      state={{ status: "idle" }}
      rowClassName={(f) => (f.severity === "WARNING" && !f.override ? "bg-held-soft/40" : undefined)}
    />
  );
}

function RowGroups({ findings, records, emptyState }: { findings: ValidationFinding[]; records: Record<number, FindingRecordSummary>; emptyState: React.ComponentProps<typeof EmptyState> }) {
  const groups = React.useMemo(() => {
    const m = new Map<number, ValidationFinding[]>();
    for (const f of findings) {
      const k = f.lineNumber ?? 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return [...m.entries()].sort((a, b) => (a[0] === 0 ? 1 : b[0] === 0 ? -1 : a[0] - b[0]));
  }, [findings]);
  const [open, setOpen] = React.useState<Record<number, boolean>>({});
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-raised">
        <EmptyState {...emptyState} />
      </div>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Findings grouped by row">
      {groups.map(([line, list], i) => {
        const rec = records[line];
        const worst = SEVERITY_ORDER.find((s) => list.some((f) => f.severity === s))!;
        const isOpen = open[line] ?? i < 10;
        const rowOutcome = worst === "COMPLETE_MEMBER_ERROR" || worst === "FILE_ERROR" ? "REJECTED" : worst === "WARNING" ? "HELD" : "ACCEPTED";
        return (
          <li key={line} className="rounded-md border border-border bg-surface-raised">
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen((s) => ({ ...s, [line]: !isOpen }))} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-4 py-3 text-left hover:bg-surface">
              {isOpen ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ink-muted" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-muted" />}
              <span className="text-h3">{line === 0 ? "File-level" : `Row ${line}`}</span>
              {rec?.sinMasked ? <MaskedSIN masked={rec.sinMasked} /> : null}
              {rec && (rec.firstName || rec.lastName) ? <span className="text-small text-ink-muted">{displayName(rec.firstName, rec.lastName)}</span> : null}
              {rec?.eventType ? (
                <span className="text-small text-ink-muted">
                  {rec.eventType} {rec.eventDate ?? ""}
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-2">
                {line !== 0 ? <OutcomeBadge outcome={rowOutcome} size="sm" /> : <SeverityBadge severity={worst} size="sm" short />}
                <span className="text-small text-ink-muted">
                  {list.length} finding{list.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
            {isOpen ? (
              <div className="space-y-2 border-t border-border p-3">
                {list.map((f) => (
                  <FindingCard key={f.findingId} finding={f} record={rec} hideRow={Boolean(rec)} compact />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}