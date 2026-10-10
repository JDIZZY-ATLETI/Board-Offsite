import Link from "next/link";
import { SeverityBadge } from "@/components/app/badges/severity-badge";
import { EmptyState } from "@/components/app/empty-state";
import type { FindingsByRuleRow } from "@/lib/queries/dashboard";
import { formatInt } from "@/lib/ui/format";
import { cn } from "@/lib/utils";

export interface FindingsByRulePanelProps {
  items: FindingsByRuleRow[];
  totalFindings: number;
  batches: number;
  days?: number;
}

/** docs/ux-design.md section 5.1 "Findings by rule - last 30 days" (Reviewer/Admin). Counts are text; the bar is decorative. */
export function FindingsByRulePanel({ items, totalFindings, batches, days = 30 }: FindingsByRulePanelProps) {
  if (items.length === 0) {
    return <EmptyState compact illustration="search" title={`No findings in the last ${days} days`} description="Rules that fire on batches received in this window appear here, most frequent first." />;
  }
  const max = Math.max(...items.map((r) => r.findings));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">
          Findings by rule in the last {days} days: {formatInt(totalFindings)} findings across {formatInt(batches)} batches, most frequent first
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-caption text-ink-muted">
            <th scope="col" className="px-3 py-2 font-medium">Rule</th>
            <th scope="col" className="px-3 py-2 font-medium">Severity</th>
            <th scope="col" className="px-3 py-2 font-medium">Findings</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Rows</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Batches</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Overridden</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={`${r.ruleId}-${r.severity}`} className="border-b border-border last:border-0 hover:bg-surface" data-testid={`findings-by-rule-${r.ruleId}`}>
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <Link href={`/admin/rules?q=${encodeURIComponent(r.ruleId)}`} className="font-mono text-brand hover:underline" title={`Open rule ${r.ruleId} in the registry`}>
                  {r.ruleId}
                </Link>
              </th>
              <td className="px-3 py-2">
                <SeverityBadge severity={r.severity} size="sm" short />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-brand-soft" aria-hidden="true">
                    <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.max(3, Math.round((r.findings / max) * 100))}%` }} />
                  </span>
                  <span className="w-10 text-right tabular-nums">{formatInt(r.findings)}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatInt(r.rows)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatInt(r.batches)}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums", r.overridden === 0 && "text-ink-faint")}>{formatInt(r.overridden)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
