"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatInt } from "@/lib/ui/format";

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface FacetSelectProps {
  label: string;
  options: FacetOption[];
  /** Selected values (multi) or a single value in `single` mode. */
  value: string[];
  onChange(next: string[]): void;
  single?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** Facet dropdown with counts: `Severity ▾ Rejected 12 · Warning 3` (section 4.5). */
export function FacetSelect({ label, options, value, onChange, single = false, className, ...rest }: FacetSelectProps) {
  const selected = options.filter((o) => value.includes(o.value));
  const summary = selected.length === 0 ? "All" : selected.length <= 2 ? selected.map((o) => o.label).join(", ") : `${selected.length} selected`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)} data-testid={rest["data-testid"]}>
          <span className="text-ink-muted">{label}</span>
          <span className={cn("max-w-[10rem] truncate", selected.length > 0 && "font-medium text-brand")}>{summary}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {single ? (
          <>
            <DropdownMenuItem onSelect={() => onChange([])} className="justify-between">
              All {value.length === 0 ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
            </DropdownMenuItem>
            {options.map((o) => (
              <DropdownMenuItem key={o.value} onSelect={() => onChange([o.value])} className="justify-between gap-3">
                <span className="truncate">{o.label}</span>
                <span className="flex items-center gap-2">
                  {o.count !== undefined ? <span className="text-caption tabular-nums text-ink-muted">{formatInt(o.count)}</span> : null}
                  {value.includes(o.value) ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <>
            {options.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.value}
                checked={value.includes(o.value)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => onChange(checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
                className="justify-between gap-3"
              >
                <span className="truncate">{o.label}</span>
                {o.count !== undefined ? <span className="text-caption tabular-nums text-ink-muted">{formatInt(o.count)}</span> : null}
              </DropdownMenuCheckboxItem>
            ))}
            {value.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onChange([])}>Clear</DropdownMenuItem>
              </>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}