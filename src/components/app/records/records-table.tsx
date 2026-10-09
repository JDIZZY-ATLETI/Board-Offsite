"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OutcomeBadge } from "@/components/app/badges/outcome-badge";
import { SeverityBadge } from "@/components/app/badges/severity-badge";
import { DataTable } from "@/components/app/data-table/data-table";
import { FacetSelect } from "@/components/app/data-table/facet-select";
import { FilterBar, useUrlFilters } from "@/components/app/data-table/filter-bar";
import { MaskedSIN } from "@/components/app/masked-sin";
import { SkeletonLoader } from "@/components/app/skeleton-loader";
import { FindingCard } from "@/components/app/findings/finding-card";
import type { RecordSummary } from "@/lib/queries/records";
import { formatDecimal, formatInt, initials as initialsOf, isoToMmddyyyy } from "@/lib/ui/format";
import { EVENTS_CSV_COLUMNS, type ValidationFinding } from "@/types";

export interface RecordsTableProps {
  batchId: string;
  records: RecordSummary[];
  nextCursor: string | null;
  prevCursors: string[];
  fileRejected: boolean;
  counts: { accepted: number; rejected: number; pending: number };
}

type NumCol = "Weeks_CurrentYear" | "LowContributions_CurrentYear" | "HighContributions_CurrentYear" | "AnnualizedEarnings_CurrentYear" | "PA_CurrentYear" | "Weeks_PreviousYear" | "LowContributions_PreviousYear" | "HighContributions_PreviousYear" | "AnnualizedEarnings_PreviousYear" | "PA_PreviousYear";

function parsedFor(r: RecordSummary, col: string): string {
  const cy = r.parsed.currentYear;
  const py = r.parsed.previousYear;
  switch (col) {
    case "SIN":
      return r.sinMasked ?? "—";
    case "LastName":
      return r.lastName ?? "—";
    case "FirstName":
      return r.firstName ?? "—";
    case "EventType":
      return r.eventType ?? "—";
    case "EmploymentEndDate":
      return r.parsed.employmentEndDate ?? "—";
    case "DateOfDeath":
      return r.parsed.dateOfDeath ?? "—";
    case "Weeks_CurrentYear":
      return formatDecimal(cy.weeks);
    case "LowContributions_CurrentYear":
      return formatDecimal(cy.lowContributions);
    case "HighContributions_CurrentYear":
      return formatDecimal(cy.highContributions);
    case "AnnualizedEarnings_CurrentYear":
      return formatInt(cy.annualizedEarnings);
    case "PA_CurrentYear":
      return formatInt(cy.pa);
    case "Weeks_PreviousYear":
      return formatDecimal(py.weeks);
    case "LowContributions_PreviousYear":
      return formatDecimal(py.lowContributions);
    case "HighContributions_PreviousYear":
      return formatDecimal(py.highContributions);
    case "AnnualizedEarnings_PreviousYear":
      return formatInt(py.annualizedEarnings);
    case "PA_PreviousYear":
      return formatInt(py.pa);
    default:
      return "—";
  }
}

/** docs/ux-design.md section 5.4.3. Rejected rows tinted rejected-soft/40, HELD held-soft/40. */
export function RecordsTable({ batchId, records, nextCursor, prevCursors, fileRejected, counts }: RecordsTableProps) {
  const url = useUrlFilters();
  const accepted = url.get("accepted");
  const eventType = url.getList("eventType");
  const q = url.get("q");
  const showPy = url.get("py") === "1";

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return records.filter((r) => {
      if (eventType.length && !eventType.includes(r.eventType ?? "(invalid)")) return false;
      if (needle) {
        const last3 = (r.sinMasked ?? "").slice(-3);
        if (!(String(r.lineNumber).includes(needle) || last3.includes(needle) || (r.lastName ?? "").toLowerCase().includes(needle))) return false;
      }
      return true;
    });
  }, [records, eventType, q]);

  const numCol = (col: NumCol, header: string, py = false): ColumnDef<RecordSummary, unknown> => ({
    id: col,
    header,
    accessorFn: (r) => parsedFor(r, col),
    cell: ({ row }) => {
      const parsed = parsedFor(row.original, col);
      const raw = row.original.rawValues[col];
      const bad = raw !== null && raw !== undefined && raw !== "" && parsed === "—";
      return bad ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-caption text-sev-cme-text underline decoration-dotted">{raw}</span>
          </TooltipTrigger>
          <TooltipContent>Could not be parsed — see findings</TooltipContent>
        </Tooltip>
      ) : (
        <span className={parsed === "—" ? "text-ink-faint" : undefined}>{parsed}</span>
      );
    },
    meta: { align: "right", priority: py ? "tertiary" : undefined, headerTitle: col },
  });

  const columns: ColumnDef<RecordSummary, unknown>[] = [
    { id: "line", header: "Row", accessorKey: "lineNumber", cell: ({ getValue }) => `#${getValue()}`, meta: { align: "right", width: "4.5rem" } },
    {
      id: "member",
      header: "Member",
      enableSorting: false,
      cell: ({ row }) => <MaskedSIN masked={row.original.sinMasked} sinPseudo={row.original.sinPseudo} initials={initialsOf(row.original.firstName, row.original.lastName)} />,
      meta: { width: "11rem" },
    },
    { id: "eventType", header: "Event type", accessorKey: "eventType", cell: ({ getValue }) => <span className="font-mono text-caption">{(getValue() as string | null) ?? "—"}</span>, meta: { width: "6rem" } },
    {
      id: "eventDate",
      header: "Event date",
      accessorKey: "eventDate",
      cell: ({ row }) => {
        const iso = row.original.eventDate;
        const rawCol = row.original.eventType === "DECFIN" ? "DateOfDeath" : "EmploymentEndDate";
        const raw = row.original.rawValues[rawCol] ?? isoToMmddyyyy(iso);
        return iso ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="tabular-nums">{iso}</span>
            </TooltipTrigger>
            <TooltipContent>
              file: <span className="font-mono">{raw}</span>
            </TooltipContent>
          </Tooltip>
        ) : raw ? (
          <span className="font-mono text-caption text-sev-cme-text">{raw}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        );
      },
      meta: { width: "7rem" },
    },
    numCol("Weeks_CurrentYear", "Weeks CY"),
    numCol("LowContributions_CurrentYear", "Low CY"),
    numCol("HighContributions_CurrentYear", "High CY"),
    numCol("AnnualizedEarnings_CurrentYear", "AE CY"),
    numCol("PA_CurrentYear", "PA CY"),
    ...(showPy ? [numCol("Weeks_PreviousYear", "Weeks PY", true), numCol("LowContributions_PreviousYear", "Low PY", true), numCol("HighContributions_PreviousYear", "High PY", true), numCol("AnnualizedEarnings_PreviousYear", "AE PY", true), numCol("PA_PreviousYear", "PA PY", true)] : []),
    {
      id: "outcome",
      header: "Outcome",
      accessorKey: "outcome",
      cell: ({ row }) => (row.original.outcome === "PENDING" ? <span className="text-caption text-ink-muted">pending</span> : <OutcomeBadge outcome={row.original.outcome} size="sm" />),
      meta: { width: "8rem" },
    },
    {
      id: "findings",
      header: "Findings",
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original.findingCounts;
        if (c.cme + c.warning + c.info === 0) return <span className="text-ink-faint">—</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {c.cme ? <SeverityBadge severity="COMPLETE_MEMBER_ERROR" size="sm" short count={c.cme} /> : null}
            {c.warning ? <SeverityBadge severity="WARNING" size="sm" short count={c.warning} /> : null}
            {c.info ? <SeverityBadge severity="INFORMATION" size="sm" short count={c.info} /> : null}
          </span>
        );
      },
    },
  ];

  const chips = [
    ...(accepted ? [{ key: "accepted", label: `Outcome: ${accepted === "true" ? "Accepted" : accepted === "false" ? "Rejected" : "Held"}`, onRemove: () => url.set({ accepted: null }) }] : []),
    ...eventType.map((e) => ({ key: `et-${e}`, label: `Event type: ${e}`, onRemove: () => url.set({ eventType: eventType.filter((x) => x !== e) }) })),
  ];

  const filters = (
    <FilterBar search={{ placeholder: "Row # or SIN last 3…", value: q, onChange: (v) => url.set({ q: v }), "aria-label": "Search records" }} chips={chips} onClear={() => url.clear(["py"])}>
      <FacetSelect
        label="Outcome"
        single
        options={[
          { value: "true", label: "Accepted", count: counts.accepted },
          { value: "false", label: "Rejected", count: counts.rejected },
          ...(counts.pending ? [{ value: "held", label: "Held / pending", count: counts.pending }] : []),
        ]}
        value={accepted ? [accepted] : []}
        onChange={(v) => url.set({ accepted: v[0] ?? null })}
        data-testid="facet-outcome"
      />
      <FacetSelect label="Event type" options={["TERFIN", "RETFIN", "DECFIN"].map((e) => ({ value: e, label: e }))} value={eventType} onChange={(v) => url.set({ eventType: v })} />
      <div className="flex items-center gap-2 pl-1">
        <Checkbox id="show-py" checked={showPy} onCheckedChange={(c) => url.set({ py: c ? "1" : null }, { resetCursor: false })} />
        <Label htmlFor="show-py" className="text-small font-normal text-ink-muted">
          Show previous-year columns
        </Label>
      </div>
    </FilterBar>
  );

  return (
    <DataTable<RecordSummary>
      data-testid="records-table"
      caption="Submitted rows"
      columns={columns}
      data={filtered}
      rowId={(r) => r.recordId}
      filters={filters}
      expandable={{ render: (r) => <RecordDetail batchId={batchId} record={r} /> }}
      pagination={{
        mode: "cursor",
        hasNext: nextCursor !== null,
        hasPrev: prevCursors.length > 0,
        pageSize: 100,
        onNext: () => nextCursor && url.set({ cursor: nextCursor, prev: [...prevCursors, url.get("cursor") || ""].join("|") }, { resetCursor: false }),
        onPrev: () => {
          const stack = [...prevCursors];
          const back = stack.pop() ?? "";
          url.set({ cursor: back || null, prev: stack.length ? stack.join("|") : null }, { resetCursor: false });
        },
      }}
      sorting="client"
      rowClassName={(r) => (r.outcome === "REJECTED" ? "bg-rejected-soft/40" : r.outcome === "PENDING" ? "bg-held-soft/40" : undefined)}
      emptyState={
        fileRejected
          ? { title: "Rows were not parsed because the file was rejected", description: "Fix the header noted in Findings and upload again.", illustration: "none" }
          : chips.length || q
            ? { title: "No rows match", description: "Adjust the outcome or event-type filter.", illustration: "search", action: <Button variant="outline" size="sm" onClick={() => url.clear(["py"])}>Clear filters</Button> }
            : { title: "No rows", description: "This file had no data rows.", illustration: "inbox" }
      }
    />
  );
}

function RecordDetail({ batchId, record }: { batchId: string; record: RecordSummary }) {
  const [findings, setFindings] = React.useState<ValidationFinding[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/batches/${batchId}/findings?lineNumber=${record.lineNumber}&limit=200`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { items: ValidationFinding[] };
      })
      .then((b) => !cancelled && setFindings(b.items))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [batchId, record.lineNumber]);

  const cols: string[] = [...EVENTS_CSV_COLUMNS, ...("DateOfDeath" in record.rawValues ? ["DateOfDeath"] : [])];
  const hasFindings = record.findingCounts.cme + record.findingCounts.warning + record.findingCounts.info > 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-label="Values as submitted">
        <h3 className="mb-2 text-h3">Values</h3>
        <table className="w-full text-small">
          <caption className="sr-only">Raw file values beside parsed values</caption>
          <thead>
            <tr className="text-left text-caption text-ink-muted">
              <th scope="col" className="py-1 pr-3 font-medium">
                Column
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                As in file
              </th>
              <th scope="col" className="py-1 font-medium">
                Parsed
              </th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => {
              const raw = record.rawValues[c];
              const parsed = parsedFor(record, c);
              const bad = raw && parsed === "—";
              return (
                <tr key={c} className="border-t border-border/60">
                  <th scope="row" className="py-1 pr-3 text-left font-mono text-caption font-normal text-ink-muted">
                    {c}
                  </th>
                  <td className="py-1 pr-3 font-mono text-caption text-ink">{raw === null || raw === undefined || raw === "" ? <span className="text-ink-faint">(blank)</span> : raw}</td>
                  <td className={`py-1 tabular-nums ${bad ? "text-sev-cme-text" : parsed === "—" ? "text-ink-faint" : "text-ink"}`}>{bad ? "not parsed" : parsed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section aria-label="Findings for this row">
        <h3 className="mb-2 text-h3">Findings</h3>
        {error ? (
          <p className="text-small text-sev-cme-text">Couldn&apos;t load findings: {error}</p>
        ) : findings === null ? (
          hasFindings ? <SkeletonLoader variant="card" /> : <p className="text-small text-ink-muted">No findings — this row passed validation.</p>
        ) : findings.length === 0 ? (
          <p className="text-small text-ink-muted">No findings — this row passed validation.</p>
        ) : (
          <div className="space-y-2">
            {findings.map((f) => (
              <FindingCard key={f.findingId} finding={f} record={record} hideRow compact />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}