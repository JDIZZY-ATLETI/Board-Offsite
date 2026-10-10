import Link from "next/link";
import { StatusBadge } from "@/components/app/badges/status-badge";
import { EmptyState } from "@/components/app/empty-state";
import type { BatchSummary } from "@/lib/queries/batches";
import { formatDateTime, formatInt, formatRelative, shortBatchId } from "@/lib/ui/format";
import { cn } from "@/lib/utils";

export interface BatchMiniTableProps {
  batches: BatchSummary[];
  caption: string;
  showEmployer: boolean;
  empty: { title: string; description?: string; action?: React.ReactNode };
  /** Link each row to a specific tab (e.g. findings for attention items). */
  hrefFor?(b: BatchSummary): string;
  relative?: boolean;
}

/** Compact server-rendered batch list for the Dashboard (max 10 rows). */
export function BatchMiniTable({ batches, caption, showEmployer, empty, hrefFor, relative = false }: BatchMiniTableProps) {
  if (batches.length === 0) return <EmptyState compact illustration="inbox" {...empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-caption text-ink-muted">
            <th scope="col" className="px-3 py-2 font-medium">Received</th>
            <th scope="col" className="px-3 py-2 font-medium">Batch</th>
            {showEmployer ? <th scope="col" className="px-3 py-2 font-medium">Employer</th> : null}
            <th scope="col" className="px-3 py-2 font-medium">File</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Rows</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Rej</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const href = hrefFor ? hrefFor(b) : `/batches/${b.batchId}`;
            return (
              <tr key={b.batchId} className="border-b border-border last:border-0 hover:bg-surface">
                <td className="px-3 py-2 tabular-nums text-ink-muted" title={formatDateTime(b.receivedAt, { seconds: true })}>
                  {relative ? formatRelative(b.receivedAt) : formatDateTime(b.receivedAt)}
                </td>
                <td className="px-3 py-2">
                  <Link href={href} className="font-mono text-caption text-brand hover:underline" title={b.batchId}>
                    {shortBatchId(b.batchId)}
                  </Link>
                </td>
                {showEmployer ? <td className="px-3 py-2 font-mono text-caption">{b.employerId}</td> : null}
                <td className="max-w-[14rem] truncate px-3 py-2" title={b.originalFilename}>
                  {b.originalFilename}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={b.status} heldCount={b.counts.held ?? 0} size="sm" />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{b.counts.rows ? formatInt(b.counts.rows) : "—"}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", b.counts.rejected > 0 && "font-medium text-rejected-text")}>{b.counts.rows ? formatInt(b.counts.rejected) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}