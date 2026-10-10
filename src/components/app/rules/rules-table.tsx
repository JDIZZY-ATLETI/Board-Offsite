"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/ui/format";
import type { RuleCatalogueItem } from "@/lib/queries/rules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SeverityBadge } from "@/components/app/badges/severity-badge";
import { DataTable } from "@/components/app/data-table/data-table";
import { FacetSelect } from "@/components/app/data-table/facet-select";
import { FilterBar, useUrlFilters } from "@/components/app/data-table/filter-bar";
import type { FindingSeverity } from "@/types";
import { RuleChangeDialog, type RuleChange } from "./rule-change-dialog";

export interface RulesTableProps {
  items: RuleCatalogueItem[];
  /** Admin edits; Reviewer reads (docs/ux-design.md section 2.2). */
  canEdit: boolean;
  /** Keys with an Admin override in rules_config_overrides, per rule. */
  overriddenKeys: Record<string, string[]>;
}

const SEVERITY_SHORT: Record<string, string> = { FILE_ERROR: "File error", COMPLETE_MEMBER_ERROR: "Rejected", WARNING: "Warning", INFORMATION: "Information" };

/** docs/ux-design.md section 5.9 rule registry: Enabled · Rule · Label · Lvl · Severity · Vis · Msg ID · Overrides · Tool · Tolerances. */
export function RulesTable({ items, canEdit, overriddenKeys }: RulesTableProps) {
  const url = useUrlFilters();
  const level = url.getList("level");
  const severity = url.getList("severity");
  const visibility = url.getList("visibility");
  const q = url.get("q");
  const disabledOnly = url.get("disabled") === "1";
  const [change, setChange] = React.useState<RuleChange | null>(null);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((r) => {
      if (level.length && !level.includes(r.level)) return false;
      if (severity.length && !severity.includes(r.severity)) return false;
      if (visibility.length && !visibility.includes(r.visibility)) return false;
      if (disabledOnly && r.enabled) return false;
      if (needle && !`${r.id} ${r.label} ${r.messageId} ${r.portalMessage}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, level, severity, visibility, disabledOnly, q]);

  const columns: ColumnDef<RuleCatalogueItem, unknown>[] = [
    {
      id: "enabled",
      header: "Enabled",
      accessorKey: "enabled",
      cell: ({ row }) => {
        const r = row.original;
        const sw = (
          <button
            type="button"
            role="switch"
            aria-checked={r.enabled}
            aria-label={`${r.enabled ? "Disable" : "Enable"} rule ${r.id}`}
            disabled={!canEdit}
            onClick={(e) => {
              e.stopPropagation();
              setChange({ kind: "enabled", rule: r, enabled: !r.enabled });
            }}
            data-testid={`rule-toggle-${r.id}`}
            className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60", r.enabled ? "border-ok bg-ok" : "border-border bg-surface")}
          >
            <span aria-hidden="true" className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", r.enabled ? "translate-x-4" : "translate-x-0.5")} />
          </button>
        );
        return (
          <span className="inline-flex items-center gap-2" onKeyDown={(e) => e.stopPropagation()}>
            {canEdit ? (
              sw
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>{sw}</TooltipTrigger>
                <TooltipContent>Read-only - an Admin changes the configuration.</TooltipContent>
              </Tooltip>
            )}
            {r.overridden ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="rounded-sm bg-sev-warn-soft px-1 text-[10px] font-medium text-sev-warn-text">overridden</span>
                </TooltipTrigger>
                <TooltipContent>Differs from the file default ({r.enabledByDefault ? "enabled" : "disabled"}).</TooltipContent>
              </Tooltip>
            ) : null}
          </span>
        );
      },
      meta: { width: "7rem" },
    },
    { id: "id", header: "Rule", accessorKey: "id", cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span>, meta: { width: "5.5rem" } },
    { id: "label", header: "Label", accessorKey: "label", cell: ({ getValue }) => <span className="line-clamp-1 max-w-xs" title={String(getValue())}>{String(getValue())}</span> },
    { id: "level", header: "Lvl", accessorKey: "level", meta: { width: "3.5rem", mono: true } },
    { id: "severity", header: "Severity", accessorKey: "severity", cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" short />, meta: { width: "9rem" } },
    {
      id: "visibility",
      header: "Vis",
      accessorKey: "visibility",
      cell: ({ row }) =>
        row.original.visibility === "PRIVATE" ? (
          <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
            <Lock aria-hidden="true" className="h-3 w-3" /> Private
          </span>
        ) : (
          <span className="text-caption text-ink-muted">Public</span>
        ),
      meta: { width: "5.5rem" },
    },
    { id: "messageId", header: "Msg ID", accessorKey: "messageId", meta: { width: "6.5rem", mono: true } },
    {
      id: "overrides",
      header: "Overrides",
      accessorFn: (r) => r.overrideReasons.length,
      cell: ({ row }) => (row.original.overrideReasons.length ? <span className="text-caption">{formatInt(row.original.overrideReasons.length)} reason{row.original.overrideReasons.length === 1 ? "" : "s"}</span> : <span className="text-ink-faint">—</span>),
      meta: { width: "6rem", priority: "secondary" },
    },
    { id: "tool", header: "Tool", accessorKey: "tool", meta: { width: "9rem", priority: "tertiary" }, cell: ({ getValue }) => <span className="text-caption text-ink-muted">{String(getValue())}</span> },
    {
      id: "tolerances",
      header: "Tolerances",
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        if (r.tolerances.length === 0) return <span className="text-ink-faint">—</span>;
        const over = overriddenKeys[r.id] ?? [];
        return (
          <span className="flex flex-wrap items-center gap-1" onKeyDown={(e) => e.stopPropagation()}>
            {r.tolerances.map((t) => (
              <span key={t.key} className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-caption", over.includes(t.key) ? "border-sev-warn/50 bg-sev-warn-soft text-sev-warn-text" : "border-border text-ink-muted")} title={`${t.key} (${t.unit})${over.includes(t.key) ? " - Admin override" : ""}`}>
                {t.key.split(".")[1]} = {t.value === null ? "—" : String(t.value)}
              </span>
            ))}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                aria-label={`Edit tolerances for ${r.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setChange({ kind: "tolerances", rule: r });
                }}
                data-testid={`rule-tolerance-${r.id}`}
              >
                <SlidersHorizontal aria-hidden="true" /> Edit
              </Button>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "reset",
      header: () => <span className="sr-only">Reset</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const hasOverrides = r.overridden || (overriddenKeys[r.id]?.length ?? 0) > 0;
        if (!canEdit || !hasOverrides) return null;
        return (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={(e) => {
              e.stopPropagation();
              setChange({ kind: "reset", rule: r });
            }}
            data-testid={`rule-reset-${r.id}`}
          >
            <RotateCcw aria-hidden="true" /> Reset to file
          </Button>
        );
      },
      meta: { width: "8rem" },
    },
  ];

  const chips = [
    ...level.map((l) => ({ key: `lvl-${l}`, label: `Level: ${l}`, onRemove: () => url.set({ level: level.filter((x) => x !== l) }) })),
    ...severity.map((s) => ({ key: `sev-${s}`, label: `Severity: ${SEVERITY_SHORT[s] ?? s}`, onRemove: () => url.set({ severity: severity.filter((x) => x !== s) }) })),
    ...visibility.map((v) => ({ key: `vis-${v}`, label: `Visibility: ${v}`, onRemove: () => url.set({ visibility: visibility.filter((x) => x !== v) }) })),
    ...(disabledOnly ? [{ key: "disabled", label: "Disabled only", onRemove: () => url.set({ disabled: null }) }] : []),
  ];

  return (
    <>
      <DataTable<RuleCatalogueItem>
        data-testid="rules-table"
        caption="Rule registry"
        columns={columns}
        data={filtered}
        rowId={(r) => r.id}
        rowTestId={(r) => `rule-row-${r.id}`}
        sorting="none"
        filters={
          <FilterBar search={{ placeholder: "Search id / label / message id…", value: q, onChange: (v) => url.set({ q: v }), "aria-label": "Search rules" }} chips={chips} onClear={() => url.clear(["tab"])}>
            <FacetSelect label="Level" options={["L0", "L1", "L2"].map((l) => ({ value: l, label: l, count: items.filter((r) => r.level === l).length }))} value={level} onChange={(v) => url.set({ level: v })} data-testid="facet-level" />
            <FacetSelect label="Severity" options={(["FILE_ERROR", "COMPLETE_MEMBER_ERROR", "WARNING", "INFORMATION"] as FindingSeverity[]).map((s) => ({ value: s, label: SEVERITY_SHORT[s], count: items.filter((r) => r.severity === s).length }))} value={severity} onChange={(v) => url.set({ severity: v })} data-testid="facet-severity" />
            <FacetSelect label="Visibility" options={["PUBLIC", "PRIVATE"].map((v) => ({ value: v, label: v === "PUBLIC" ? "Public" : "Private", count: items.filter((r) => r.visibility === v).length }))} value={visibility} onChange={(v) => url.set({ visibility: v })} data-testid="facet-visibility" />
            <div className="flex items-center gap-2 pl-1">
              <Checkbox id="disabled-only" checked={disabledOnly} onCheckedChange={(c) => url.set({ disabled: c ? "1" : null })} />
              <Label htmlFor="disabled-only" className="text-small font-normal text-ink-muted">
                Show disabled only
              </Label>
            </div>
          </FilterBar>
        }
        expandable={{
          render: (r) => (
            <div className="grid gap-3 text-small lg:grid-cols-2">
              <div className="space-y-2">
                <p>
                  <span className="font-medium text-ink">DataImport message: </span>
                  <span className="font-mono text-caption text-ink-muted">{r.dataImportMessage}</span>
                </p>
                <p>
                  <span className="font-medium text-ink">Portal message: </span>
                  {r.portalMessage}
                </p>
                {r.specNote ? (
                  <p>
                    <span className="font-medium text-ink">Spec note: </span>
                    {r.specNote}
                  </p>
                ) : null}
                <p className="text-caption text-ink-muted">
                  Section {r.section.join(", ")} · {r.requiresAriel ? "reads the Ariel snapshot" : "file-only"} · default {r.enabledByDefault ? "enabled" : "disabled"} · message ids {r.messageIds.join(", ") || r.messageId}
                </p>
              </div>
              <div>
                <p className="font-medium text-ink">Override reasons {r.overrideReasons.length ? `(${r.overrideReasons.length})` : ""}</p>
                {r.overrideReasons.length ? (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    {r.overrideReasons.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-ink-muted">None - this rule cannot be overridden.</p>
                )}
              </div>
            </div>
          ),
        }}
        // Disabled rules are tinted, not faded: opacity pushed badge/muted text below the 4.5:1 contrast gate (ux 8.1).
        rowClassName={(r) => (!r.enabled ? "bg-surface" : undefined)}
        emptyState={{ title: "No rules match", description: "Adjust the level, severity or visibility filter.", illustration: "search" }}
      />
      <RuleChangeDialog change={change} onClose={() => setChange(null)} />
    </>
  );
}