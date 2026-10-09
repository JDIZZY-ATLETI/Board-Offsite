import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { requirePageRole } from "@/lib/auth/page-session";
import { getLastVerification, getLedgerHead, listLedgerEntries } from "@/lib/queries/ledger";
import { formatDateTime, formatInt, shortBatchId } from "@/lib/ui/format";
import { enumParam, firstParam, intParam, type SearchParamsInput } from "@/lib/ui/search-params";
import { EntryDrawer } from "@/components/app/ledger/entry-drawer";
import { IntegrityBanner } from "@/components/app/ledger/integrity-banner";
import { LedgerTable } from "@/components/app/ledger/ledger-table";
import { PageHeader } from "@/components/app/page-header";
import { LEDGER_EVENT_TYPES, type LedgerEventType } from "@/types";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** docs/ux-design.md section 5.6. Reviewer reads; Admin also verifies. `?seq=` opens the entry drawer. */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;
  const session = await requirePageRole("Reviewer", "Admin");
  const ctx = await getAppContext();
  const streamKind = enumParam(sp, "stream", ["batch", "member", "system"] as const);
  const eventTypes = (firstParam(sp, "eventType") ?? "").split(",").filter((e): e is LedgerEventType => (LEDGER_EVENT_TYPES as readonly string[]).includes(e));
  const batchIdRaw = firstParam(sp, "batchId");
  const batchId = batchIdRaw && UUID.test(batchIdRaw) ? batchIdRaw : undefined;
  const fromSeq = intParam(sp, "fromSeq");
  const toSeq = intParam(sp, "toSeq");
  const cursor = firstParam(sp, "cursor") ?? null;
  const prev = (firstParam(sp, "prev") ?? "").split("|").filter(Boolean);

  const [head, last, page] = await Promise.all([
    getLedgerHead(ctx),
    getLastVerification(ctx),
    listLedgerEntries(ctx, { streamKind, eventType: eventTypes[0], batchId, fromSeq, toSeq, cursor, limit: 50, order: "desc" }),
  ]);
  // The API accepts one event type; extra selections are applied to the loaded page.
  const entries = eventTypes.length > 1 ? page.items.filter((e) => eventTypes.includes(e.eventType)) : page.items;
  const firstBadSeq = last && !last.ok ? (last.firstBadSeq ?? null) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ledger"
        description={batchId ? `Entries written by batch ${shortBatchId(batchId)} (including member streams it touched).` : "Append-only, SHA-256 hash-chained record of every batch, member outcome and decision."}
        breadcrumbs={[{ label: "Audit" }, { label: "Ledger explorer" }]}
      />
      <IntegrityBanner head={head} result={last} canVerify={session.role === "Admin"} showVerify variant="full" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-4 py-2 text-small text-ink-muted" data-testid="ledger-head">
        <span className="font-medium text-ink">Head</span>
        <span>
          seq <span className="font-mono tabular-nums text-ink">{formatInt(head.seq)}</span>
        </span>
        <span>
          streams <span className="tabular-nums text-ink">{formatInt(head.streams)}</span>
        </span>
        <span>
          last anchor{" "}
          <span className="text-ink">{last ? <time dateTime={last.verifiedAt}>{formatDateTime(last.verifiedAt)}</time> : "—"}</span>
        </span>
      </div>
      <LedgerTable entries={entries} nextCursor={page.nextCursor} prevCursors={prev} firstBadSeq={firstBadSeq} batchScoped={Boolean(batchId)} />
      <EntryDrawer headSeq={head.seq} />
    </div>
  );
}