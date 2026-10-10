"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/ui/format";
import { DataTable } from "@/components/app/data-table/data-table";
import { FacetSelect } from "@/components/app/data-table/facet-select";
import { FilterBar, useUrlFilters } from "@/components/app/data-table/filter-bar";
import { MaskedSIN } from "@/components/app/masked-sin";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ArielMemberListItem {
  sinPseudo: string;
  sinMasked: string;
  lastName: string | null;
  firstName: string | null;
  dateOfBirth: string;
  dateOfDeath: string | null;
  status: string | null;
  subStatus: string | null;
  scenario: string | null;
  employments: Array<{ employerId: string; terminationCode: string | null; terminationDate: string | null; permanencyDate: string }>;
  duplicateSin: boolean;
}

export interface ArielMembersTableProps {
  items: ArielMemberListItem[];
  employers: Array<{ employerId: string; name: string }>;
  /** Seed scenario tags are dev-only (docs/ux-design.md section 5.8). */
  showScenario: boolean;
}

/** docs/ux-design.md section 5.8: Member · DOB (year) · Status · Employments (chip per employer) · Scenario. */
export function ArielMembersTable({ items, employers, showScenario }: ArielMembersTableProps) {
  const url = useUrlFilters();
  const router = useRouter();
  const employerId = url.get("employerId");
  const q = url.get("q");

  const columns: ColumnDef<ArielMemberListItem, unknown>[] = [
    {
      id: "member",
      header: "Member",
      accessorFn: (m) => `${m.lastName ?? ""} ${m.firstName ?? ""}`,
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <MaskedSIN masked={row.original.sinMasked} />
          <span className="text-ink">
            {row.original.lastName ?? "—"}, {row.original.firstName ?? "—"}
          </span>
          {row.original.duplicateSin ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="rounded-sm bg-sev-warn-soft px-1.5 py-0.5 text-caption font-medium text-sev-warn-text">duplicate SIN</span>
              </TooltipTrigger>
              <TooltipContent>Two member rows share this SIN - B204 rejects Events rows for it.</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      id: "dob",
      header: "DOB",
      accessorKey: "dateOfBirth",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="tabular-nums">{row.original.dateOfBirth.slice(0, 4)}</span>
          </TooltipTrigger>
          <TooltipContent>
            {row.original.dateOfBirth}
            {row.original.dateOfDeath ? ` · died ${row.original.dateOfDeath}` : ""}
          </TooltipContent>
        </Tooltip>
      ),
      meta: { width: "5rem" },
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (m) => `${m.status ?? ""}/${m.subStatus ?? ""}`,
      cell: ({ row }) => (
        <span className="font-mono text-caption">
          {row.original.status ?? "—"}
          {row.original.subStatus ? ` / ${row.original.subStatus}` : ""}
        </span>
      ),
      meta: { width: "7rem" },
    },
    {
      id: "employments",
      header: "Employments",
      accessorFn: (m) => m.employments.length,
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="tabular-nums">{formatInt(row.original.employments.length)}</span>
          {row.original.employments.map((e, i) => (
            <span key={`${e.employerId}-${i}`} className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-caption", e.terminationDate ? "border-border text-ink-muted" : "border-ok/40 bg-ok-soft text-ok-text")} title={e.terminationDate ? `${e.employerId} · terminated ${e.terminationDate} (${e.terminationCode ?? "—"})` : `${e.employerId} · active since ${e.permanencyDate}`}>
              {e.employerId}
              {e.terminationCode ? ` ${e.terminationCode}` : ""}
            </span>
          ))}
        </span>
      ),
    },
    ...(showScenario
      ? [
          {
            id: "scenario",
            header: "Scenario",
            accessorKey: "scenario",
            cell: ({ row }: { row: { original: ArielMemberListItem } }) => (row.original.scenario ? <span className="text-caption text-ink-muted">{row.original.scenario}</span> : <span className="text-ink-faint">—</span>),
            meta: { priority: "tertiary" },
          } satisfies ColumnDef<ArielMemberListItem, unknown>,
        ]
      : []),
  ];

  const chips = [...(employerId ? [{ key: "employer", label: `Employer: ${employerId}`, onRemove: () => url.set({ employerId: null }) }] : [])];

  return (
    <DataTable<ArielMemberListItem>
      data-testid="ariel-members-table"
      caption="Mock Ariel members"
      columns={columns}
      data={items}
      rowId={(m) => `${m.sinPseudo}`}
      rowTestId={(m) => `ariel-member-${m.sinPseudo.slice(0, 12)}`}
      filters={
        <FilterBar search={{ placeholder: "Search name…", value: q, onChange: (v) => url.set({ q: v }), "aria-label": "Search members by name" }} chips={chips} onClear={() => url.clear([])}>
          <FacetSelect label="Employer" single options={employers.map((e) => ({ value: e.employerId, label: `${e.employerId} · ${e.name}` }))} value={employerId ? [employerId] : []} onChange={(v) => url.set({ employerId: v[0] ?? null })} data-testid="facet-employer" />
        </FilterBar>
      }
      onRowClick={(m) => router.push(`/ariel/members/${m.sinPseudo}`)}
      sorting="client"
      pagination={{ mode: "client", pageSize: 50 }}
      emptyState={{ title: "No members match", description: "Try another employer or clear the search.", illustration: "search" }}
    />
  );
}