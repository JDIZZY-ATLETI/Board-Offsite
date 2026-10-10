"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Download, ShieldCheck } from "lucide-react";
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
import { FindingCard, OverrideStrip, type FindingRecordSummary } from "./finding-card";
import { OverrideDrawer, type OverrideTarget } from "./override-drawer";
import { RejectedCsvButton } from "./rejected-csv-button";
import type { FindingSeverity, RecordOutcome, Role, ValidationFinding } from "@/types";

export type GroupMode = "row" | "severity" | "rule";

export interface FindingsRecord extends FindingRecordSummary {
  /** Row outcome (HELD rows are the only ones an override can release). */
  outcome?: RecordOutcome | "PENDING";
}

export interface FindingsViewProps {
  batchId: string;
  findings: ValidationFinding[];
  /** Keyed by lineNumber. */
  records: Record<number, FindingsRecord>;
  facets: FindingFacets;
  role: Role;
  nextCursor: string | null;
  prevCursors: string[];
  rejectedRows: number;
  fileRejected: boolean;
  canSeePrivate: boolean;
  /** Reviewer/Admin, or Submitter when ALLOW_SUBMITTER_OVERRIDE is on (docs/ux-design.md D6). */
  canOverride?: boolean;
  /** Overrides are only accepted while the batch is VALIDATED. */
  batchStatus?: string;
}

const SEVERITY_ORDER: FindingSeverity[] = ["FILE_ERROR", "COMPLETE_MEMBER_ERROR", "WARNING", "INFORMATION"];

export function defaultGroupMode(role: Role): GroupMode {
  return role === "EmployerSubmitter" ? "row" : "severity";
}

export const SUBMITTER_OVERRIDE_COPY = "A HOOPP reviewer will choose an override reason. No file change is needed if the value is correct.";

/**
 * Why a pending WARNING cannot be overridden right now, or null when it can (docs/ux-design.md D6, architecture
 * 7.5 ROW_REJECTED / BATCH_NOT_VALIDATED).
 */
export function overrideBlockedReason(f: ValidationFinding, record: FindingsRecord | null | undefined, canOverride: boolean, batchStatus: string | undefined): string | null {
  if (f.severity !== "WARNING" || f.override) return null;
  if (!canOverride) return SUBMITTER_OVERRIDE_COPY;
  if (record?.outcome === "REJECTED") return "Row rejected by a member error - the warning cannot be overridden.";
  if (batchStatus && batchStatus !== "VALIDATED") return "Overrides are only possible while the batch is Validated.";
  return null;
}

/** docs/ux-design.md section 5.4.2 / 4.8. Submitter default = by row (D1), Reviewer = by severity. */
export function FindingsView({ batchId, findings, records, facets, role, nextCursor, prevCursors, rejectedRows, fileRejected, canSeePrivate, canOverride = false, batchStatus }: FindingsViewProps) {
  const url = useUrlFilters();
  const group = (url.get("group") as GroupMode) || defaultGroupMode(role);
  const severity = url.getList("severity");
  const ruleId = url.getList("ruleId");
  const field = url.getList("field");
  const override = url.get("override");
  const q = url.get("q");
  const showPrivate = url.get("visibility") !== "PUBLIC";
  const [drawerTargets, setDrawerTargets] = React.useState<OverrideTarget[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return findings.filter((f) => {
      if (field.length && (!f.field || !field.includes(f.field))) return false;
      if (needle && !`${f.portalMessage} ${f.ruleId} ${f.messageId} ${f.field ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [findings, field, q]);

  const recordOf = React.useCallback((f: ValidationFinding) => (f.lineNumber ? records[f.lineNumber] : null), [records]);
  const blocked = React.useCallback((f: ValidationFinding) => overrideBlockedReason(f, recordOf(f), canOverride, batchStatus), [recordOf, canOverride, batchStatus]);
  const overridable = React.useCallback((f: ValidationFinding) => f.severity === "WARNING" && !f.override && blocked(f) === null, [blocked]);
  const openDrawer = React.useCallback((list: ValidationFinding[]) => setDrawerTargets(list.map((f) => ({ finding: f, record: recordOf(f) ?? null }))), [recordOf]);

  // Selection only keeps findings that are still overridable and visible.
  const selectable = React.useMemo(() => filtered.filter(overridable), [filtered, overridable]);
  const selectedList = selectable.filter((f) => selected.has(f.findingId));
  const selectedRules = new Set(selectedList.map((f) => f.ruleId));
  const bulkReady = selectedList.length > 1 && selectedRules.size === 1;
  const bulkHint = selectedList.length <= 1 ? "Select two or more pending warnings of the same rule." : selectedRules.size > 1 ? `Selected warnings span ${selectedRules.size} rules - one reason applies to one rule at a time.` : null;

  const chips = [
    ...severity.map((s) => ({ key: `sev-${s}`, label: `Severity: ${SEVERITY_SHORT[s as FindingSeverity] ?? s}`, onRemove: () => url.set({ severity: severity.filter((x) => x !== s) }) })),
    ...ruleId.map((r) => ({ key: `rule-${r}`, label: `Rule: ${r}`, onRemove: () => url.set({ ruleId: ruleId.filter((x) => x !== r) }) })),
    ...field.map((f) => ({ key: `field-${f}`, label: `Field: ${f}`, onRemove: () => url.set({ field: field.filter((x) => x !== f) }) })),
    ...(override ? [{ key: "override", label: override === "pending" ? "Override: pending" : "Override: recorded", onRemove: () => url.set({ override: null }) }] : []),
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
      <FacetSelect label="Override" single options={[{ value: "pending", label: "Pending" }, { value: "done", label: "Recorded" }]} value={override ? [override] : []} onChange={(v) => url.set({ override: v[0] ?? null })} data-testid="facet-override" />
      {canSeePrivate ? (
        <div className="flex items-center gap-2 pl-1">
          <Checkbox id="show-private" checked={showPrivate} onCheckedChange={(c) => url.set({ visibility: c ? null : "PUBLIC" })} data-testid="visibility-toggle" />
          <Label htmlFor="show-private" className="text-small font-normal text-ink-muted">
            Show HOOPP-internal findings
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

  const bulkButton = canOverride ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="outline" size="sm" disabled={!bulkReady} onClick={() => openDrawer(selectedList)} data-testid="bulk-override-button">
            <ShieldCheck aria-hidden="true" /> Override {selectedList.length > 0 ? `${formatInt(selectedList.length)} selected` : "selected"}…
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{bulkHint ?? `Record one reason for ${formatInt(selectedList.length)} ${[...selectedRules][0]} warnings`}</TooltipContent>
    </Tooltip>
  ) : null;

  const downloads = (
    <>
      {rejectedRows > 0 ? <RejectedCsvButton batchId={batchId} rejectedRows={rejectedRows} /> : null}
      <Button asChild variant="outline" size="sm">
        <a href={`/api/batches/${batchId}/reports/summary-of-validations.csv`} download data-testid="download-summary">
          <Download aria-hidden="true" /> Summary of validations
        </a>
      </Button>
      {canSeePrivate ? (
        <Button asChild variant="outline" size="sm">
          <a href={`/api/batches/${batchId}/reports/summary-of-validations.private.csv`} download data-testid="download-summary-private">
            <Download aria-hidden="true" /> Summary (incl. HOOPP-internal)
          </a>
        </Button>
      ) : null}
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

  const drawer = (
    <OverrideDrawer
      batchId={batchId}
      targets={drawerTargets ?? []}
      open={drawerTargets !== null}
      onOpenChange={(o) => !o && setDrawerTargets(null)}
      onRecorded={() => setSelected(new Set())}
    />
  );

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
        <RowGroups findings={filtered} records={records} emptyState={emptyState} onOverride={(f) => openDrawer([f])} blocked={blocked} />
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
        {drawer}
      </div>
    );
  }

  const columns: ColumnDef<ValidationFinding, unknown>[] = [
    ...(canOverride
      ? [
          {
            id: "select",
            header: () => <span className="sr-only">Select for bulk override</span>,
            enableSorting: false,
            cell: ({ row }: { row: { original: ValidationFinding } }) => {
              const f = row.original;
              if (!overridable(f)) return null;
              return (
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select warning ${f.ruleId} on row ${f.lineNumber ?? ""} for bulk override`}
                    checked={selected.has(f.findingId)}
                    onCheckedChange={(c) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (c) next.add(f.findingId);
                        else next.delete(f.findingId);
                        return next;
                      })
                    }
                    data-testid={`select-finding-${f.findingId}`}
                  />
                </span>
              );
            },
            meta: { width: "2.5rem" },
          } satisfies ColumnDef<ValidationFinding, unknown>,
        ]
      : []),
    { id: "severity", header: "Severity", accessorKey: "severity", cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" short />, meta: { width: "9rem" } },
    { id: "row", header: "Row", accessorKey: "lineNumber", cell: ({ row }) => (row.original.lineNumber ? `#${row.original.lineNumber}` : "file"), meta: { align: "right", width: "4.5rem" } },
    {
      id: "member",
      header: "Member",
      enableSorting: false,
      cell: ({ row }) => {
        const r = recordOf(row.original);
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
      cell: ({ row }) => <OverrideCell finding={row.original} blocked={blocked(row.original)} canOverride={canOverride} onOverride={(f) => openDrawer([f])} />,
      meta: { width: "9rem", priority: "secondary" },
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
    <>
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
            {bulkButton}
            {downloads}
          </>
        }
        groupBy={groupBy}
        expandable={{ render: (f) => <FindingCard finding={f} record={recordOf(f)} onOverride={canOverride ? (x) => openDrawer([x]) : undefined} overrideBlocked={blocked(f)} /> }}
        pagination={pagination}
        sorting="client"
        emptyState={emptyState}
        state={{ status: "idle" }}
        rowClassName={(f) => (f.severity === "WARNING" && !f.override ? (recordOf(f)?.outcome === "REJECTED" ? "bg-rejected-soft/30" : "bg-held-soft/40") : undefined)}
        rowTestId={(f) => `finding-row-${f.findingId}`}
      />
      {drawer}
    </>
  );
}

function OverrideCell({ finding: f, blocked, canOverride, onOverride }: { finding: ValidationFinding; blocked: string | null; canOverride: boolean; onOverride(f: ValidationFinding): void }) {
  if (f.override) {
    const actor = f.override.actor.replace(/^user:/, "");
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-caption text-held-text" data-testid={`override-state-${f.findingId}`}>
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> Overridden
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {f.override.reason} · by {actor} · {f.override.at.slice(0, 16).replace("T", " ")}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (f.severity !== "WARNING") return <span className="text-ink-faint">—</span>;
  if (blocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-caption text-held-text" data-testid={`override-state-${f.findingId}`}>
            pending{canOverride ? " · n/a" : ""}
          </span>
        </TooltipTrigger>
        <TooltipContent>{blocked}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 border-held/50 text-held-text hover:bg-held-soft"
      onClick={(e) => {
        e.stopPropagation();
        onOverride(f);
      }}
      data-testid={`override-button-${f.findingId}`}
    >
      Override…
    </Button>
  );
}

function RowGroups({ findings, records, emptyState, onOverride, blocked }: { findings: ValidationFinding[]; records: Record<number, FindingsRecord>; emptyState: React.ComponentProps<typeof EmptyState>; onOverride(f: ValidationFinding): void; blocked(f: ValidationFinding): string | null }) {
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
        const pendingWarnings = list.filter((f) => f.severity === "WARNING" && !f.override).length;
        const rowOutcome: RecordOutcome = rec?.outcome && rec.outcome !== "PENDING" ? rec.outcome : worst === "COMPLETE_MEMBER_ERROR" || worst === "FILE_ERROR" ? "REJECTED" : pendingWarnings > 0 ? "HELD" : "ACCEPTED";
        const overriddenCount = list.filter((f) => f.override).length;
        return (
          <li key={line} className={cn("rounded-md border border-border bg-surface-raised", rowOutcome === "HELD" && "border-held/40 bg-held-soft/20")} data-testid={line ? `finding-row-group-${line}` : "finding-row-group-file"}>
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
                {rowOutcome === "HELD" ? <span className="text-small text-held-text">override pending</span> : overriddenCount ? <span className="text-small text-held-text">{overriddenCount} overridden</span> : null}
                <span className="text-small text-ink-muted">
                  {list.length} finding{list.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
            {isOpen ? (
              <div className="space-y-2 border-t border-border p-3">
                {list.map((f) => (
                  <FindingCard key={f.findingId} finding={f} record={rec} hideRow={Boolean(rec)} compact onOverride={blocked(f) === null && f.severity === "WARNING" && !f.override ? onOverride : undefined} overrideBlocked={blocked(f)} />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export { OverrideStrip };