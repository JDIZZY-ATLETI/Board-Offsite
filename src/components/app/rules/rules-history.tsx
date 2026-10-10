import Link from "next/link";
import { formatDateTime, formatInt } from "@/lib/ui/format";
import { EmptyState } from "@/components/app/empty-state";
import { HashChip } from "@/components/app/ledger/hash-chip";
import type { LedgerEntry, RulesConfigChangedPayload } from "@/types";

/** docs/ux-design.md section 5.9 "Change history": RulesConfigChanged entries on the `system` stream, newest first. */
export function RulesHistory({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-raised" data-testid="rules-history">
        <EmptyState illustration="inbox" title="No configuration changes yet" description="Admin changes to rule flags and tolerances are ledgered here with their reason." />
      </div>
    );
  }
  return (
    <ol className="space-y-2" data-testid="rules-history" aria-label="Rules configuration change history">
      {entries.map((e) => {
        const p = e.payload as unknown as RulesConfigChangedPayload;
        return (
          <li key={e.seq} className="rounded-md border border-border bg-surface-raised p-4" data-testid={`rules-history-${e.seq}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
              <Link href={`/ledger?seq=${e.seq}`} className="font-mono text-brand underline-offset-2 hover:underline">
                #{formatInt(e.seq)}
              </Link>
              <time dateTime={e.occurredAt} className="text-ink-muted">
                {formatDateTime(e.occurredAt, { seconds: true })}
              </time>
              <span className="text-ink-muted">by {e.actor.replace(/^user:/, "")}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-caption text-ink-muted">
                <HashChip hash={p.previousHash} truncate={8} /> → <HashChip hash={p.newHash} truncate={8} />
              </span>
            </div>
            <p className="mt-2 text-body text-ink">&ldquo;{p.reason}&rdquo;</p>
            <ul className="mt-2 space-y-0.5 font-mono text-caption text-ink-muted">
              {p.changes.map((c, i) => (
                <li key={i}>
                  <span className="text-ink">{c.ruleId}</span>.{c.key}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}