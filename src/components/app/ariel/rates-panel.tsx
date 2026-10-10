import { ChevronRight } from "lucide-react";
import { formatDecimal, formatInt } from "@/lib/ui/format";
import type { RateTableRow } from "@/types";

const TABLE_LABELS: Record<string, string> = { MGA: "YMPE (MGA)", PAMAXDB: "PA maximum (PAMAXDB)", REDFE: "PA offset (REDFE)", LOWRATE: "Low contribution rate", HIGHRATE: "High contribution rate" };

/** docs/ux-design.md section 5.8 rates panel: one row per year, `placeholder` rows carry an amber chip (architecture 18 Q9). */
export function RatesPanel({ rows, adapter }: { rows: RateTableRow[]; adapter: string }) {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const tables = ["MGA", "PAMAXDB", "REDFE", "LOWRATE", "HIGHRATE"].filter((t) => rows.some((r) => r.table === t));
  const byKey = new Map(rows.map((r) => [`${r.table}:${r.year}`, r]));
  const placeholders = rows.filter((r) => r.placeholder).length;
  return (
    <details className="rounded-md border border-border bg-surface-raised" data-testid="ariel-rates-panel">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-h3 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform [details[open]_&]:rotate-90" />
        Rate tables
        <span className="text-small font-normal text-ink-muted">
          {formatInt(years.length)} years · {years[0]}–{years[years.length - 1]} · adapter {adapter}
        </span>
        {placeholders > 0 ? (
          <span className="ml-auto rounded-sm bg-sev-warn-soft px-1.5 py-0.5 text-caption font-medium text-sev-warn-text" data-testid="placeholder-chip">
            {placeholders === rows.length ? "all values are placeholders (Q9)" : `${formatInt(placeholders)} placeholder values`}
          </span>
        ) : null}
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-small">
          <caption className="sr-only">Rate tables by year; placeholder values are not confirmed by HOOPP</caption>
          <thead>
            <tr className="border-b border-border text-left text-caption text-ink-muted">
              <th scope="col" className="px-4 py-2 font-medium">Year</th>
              {tables.map((t) => (
                <th key={t} scope="col" className="px-3 py-2 text-right font-medium">
                  {TABLE_LABELS[t] ?? t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y} className="border-b border-border/60 last:border-0">
                <th scope="row" className="px-4 py-1.5 text-left font-mono font-normal tabular-nums">
                  {y}
                </th>
                {tables.map((t) => {
                  const r = byKey.get(`${t}:${y}`);
                  return (
                    <td key={t} className="px-3 py-1.5 text-right tabular-nums">
                      {r ? (
                        <span className="inline-flex items-center gap-1">
                          {t === "LOWRATE" || t === "HIGHRATE" ? formatDecimal(r.value, 3) : formatDecimal(r.value, 0)}
                          {r.placeholder ? (
                            <abbr title="Placeholder value - not confirmed by HOOPP (architecture 18 Q9)" className="rounded-sm bg-sev-warn-soft px-1 text-[10px] font-medium text-sev-warn-text no-underline" data-testid="placeholder-chip">
                              placeholder
                            </abbr>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}