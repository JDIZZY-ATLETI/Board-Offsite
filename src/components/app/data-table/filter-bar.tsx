"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** URL-state access for filter controls: read/replace query params without a full navigation. */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = React.useCallback((key: string) => sp.get(key) ?? "", [sp]);
  const getList = React.useCallback((key: string) => (sp.get(key) ?? "").split(",").filter(Boolean), [sp]);
  const set = React.useCallback(
    (patch: Record<string, string | string[] | null | undefined>, opts: { resetCursor?: boolean } = { resetCursor: true }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        const val = Array.isArray(v) ? v.join(",") : v;
        if (val === null || val === undefined || val === "") next.delete(k);
        else next.set(k, val);
      }
      if (opts.resetCursor !== false) next.delete("cursor");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, sp],
  );
  const clear = React.useCallback((keep: string[] = []) => {
    const next = new URLSearchParams();
    for (const k of keep) {
      const v = sp.get(k);
      if (v) next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, sp]);
  return { get, getList, set, clear, params: sp };
}

export interface ActiveChip {
  key: string;
  label: string;
  onRemove(): void;
}

export interface FilterBarProps {
  children?: React.ReactNode;
  search?: { placeholder: string; value: string; onChange(v: string): void; debounceMs?: number; "aria-label"?: string };
  chips?: ActiveChip[];
  onClear?(): void;
  end?: React.ReactNode;
  className?: string;
}

/** Horizontal toolbar: facets · search · active chips · Clear filters (section 4.5). */
export function FilterBar({ children, search, chips = [], onClear, end, className }: FilterBarProps) {
  const [local, setLocal] = React.useState(search?.value ?? "");
  React.useEffect(() => setLocal(search?.value ?? ""), [search?.value]);
  React.useEffect(() => {
    if (!search) return;
    if (local === search.value) return;
    const t = setTimeout(() => search.onChange(local), search.debounceMs ?? 300);
    return () => clearTimeout(t);
  }, [local, search]);
  const hasFilters = chips.length > 0 || (search?.value ?? "") !== "";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search ? (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input type="search" aria-label={search["aria-label"] ?? search.placeholder} placeholder={search.placeholder} value={local} onChange={(e) => setLocal(e.target.value)} className="h-8 w-64 pl-8 text-small" />
          </div>
        ) : null}
        {children}
        {hasFilters && onClear ? (
          <Button variant="link" size="sm" onClick={onClear} className="px-1">
            Clear filters
          </Button>
        ) : null}
        {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key}>
              <button type="button" onClick={c.onRemove} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-0.5 text-caption text-ink hover:bg-surface-raised" aria-label={`Remove filter ${c.label}`}>
                {c.label}
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}