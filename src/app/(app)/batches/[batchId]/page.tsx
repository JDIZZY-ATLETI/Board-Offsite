import Link from "next/link";
import { Upload } from "lucide-react";
import { getAppContext } from "@/lib/app-context";
import { canViewPrivateFindings } from "@/lib/auth/roles";
import { findingFacets, listFindings } from "@/lib/queries/findings";
import { readReport } from "@/lib/queries/reports";
import { recordOutcomeCounts } from "@/lib/queries/records";
import { formatBytes, formatInt } from "@/lib/ui/format";
import { nextStepCopy } from "@/lib/ui/next-step";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/app/alert";
import { HashChip } from "@/components/app/ledger/hash-chip";
import { FindingCard } from "@/components/app/findings/finding-card";
import { StatCard } from "@/components/app/stat-card";
import { loadBatchPage } from "./_lib";

export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.4.1 Overview. */
export default async function BatchOverviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const { session, batch, heldCount } = await loadBatchPage(batchId);
  const ctx = await getAppContext();
  const includePrivate = canViewPrivateFindings(session);
  const [facets, outcomes, fileFindings, manifest] = await Promise.all([
    findingFacets(ctx, batchId, includePrivate),
    recordOutcomeCounts(ctx, batchId),
    batch.status === "FILE_REJECTED" ? listFindings(ctx, batchId, { includePrivate, severity: "FILE_ERROR", limit: 20 }) : Promise.resolve(null),
    readReport(ctx, batch, "manifest.json").catch(() => null),
  ]);
  const base = `/batches/${batch.batchId}`;
  const step = nextStepCopy(batch.status, session.role, { heldCount, failureReason: batch.failureReason });
  const ctaHref = step.cta ? ({ "findings-held": `${base}/findings?severity=WARNING`, "update-set": `${base}/update-set`, reports: `${base}/reports`, upload: "/upload" } as const)[step.cta.target] : null;
  const rejectedFindings = facets.bySeverity.find((s) => s.value === "COMPLETE_MEMBER_ERROR")?.count ?? 0;
  const infoCount = facets.bySeverity.find((s) => s.value === "INFORMATION")?.count ?? 0;
  const parsedManifest = manifest ? safeJson<{ encodingDetected?: string; lineCount?: number }>(manifest.bytes.toString("utf8")) : null;
  const isAdmin = session.role === "Admin";

  return (
    <div className="space-y-6">
      {batch.status === "FILE_REJECTED" ? (
        <Alert
          variant="error"
          title="This file was rejected before any rows were validated"
          actions={
            session.role !== "Reviewer" ? (
              <Button asChild size="sm">
                <Link href="/upload">
                  <Upload aria-hidden="true" /> Fix the header and upload again
                </Link>
              </Button>
            ) : null
          }
        >
          <div className="mt-2 space-y-2">
            {fileFindings?.items.map((f) => (
              <FindingCard key={f.findingId} finding={f} compact />
            ))}
          </div>
        </Alert>
      ) : null}
      {batch.status === "FAILED" ? (
        <Alert variant="error" title="Processing failed">
          {session.role === "EmployerSubmitter" ? "Processing hit a problem on our side. HOOPP has been notified." : (batch.failureReason ?? "No failure reason recorded.")}
          {isAdmin ? <p className="mt-1 text-caption">Retry arrives with the Admin actions in a later phase.</p> : null}
        </Alert>
      ) : null}
      {batch.status === "VALIDATED" && heldCount > 0 ? (
        <Alert
          variant="warning"
          title={`${formatInt(heldCount)} warning${heldCount === 1 ? "" : "s"} need an override before this batch can continue`}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/findings?severity=WARNING`}>Open held rows</Link>
            </Button>
          }
        />
      ) : null}

      <section aria-label="Counts" className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Rows" value={batch.counts.rows} data-testid="kpi-rows" />
        <StatCard label="Accepted" value={batch.counts.accepted} status={batch.counts.rows ? "ok" : "neutral"} data-testid="kpi-accepted" />
        <StatCard label="Rejected" value={batch.counts.rejected} status={batch.counts.rejected > 0 ? "bad" : "neutral"} href={batch.counts.rejected > 0 ? `${base}/findings?severity=COMPLETE_MEMBER_ERROR` : undefined} footer={rejectedFindings ? `${formatInt(rejectedFindings)} member-error findings` : undefined} data-testid="kpi-rejected" />
        <StatCard label="Warnings" value={batch.counts.warnings} status={heldCount > 0 ? "attention" : "neutral"} footer={`${formatInt(heldCount)} held`} href={heldCount > 0 ? `${base}/findings?severity=WARNING&override=pending` : undefined} data-testid="kpi-warnings" />
        <StatCard label="Info" value={infoCount} />
        <StatCard label="Update items" value={null} format="raw" footer="Available in a later phase" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Outcome by event type</CardTitle>
          </CardHeader>
          <CardContent>
            {outcomes.byEventType.length === 0 ? (
              <p className="text-small text-ink-muted">No rows parsed.</p>
            ) : (
              <table className="w-full text-small">
                <caption className="sr-only">Rows, accepted and rejected per event type</caption>
                <thead>
                  <tr className="text-left text-caption text-ink-muted">
                    <th scope="col" className="py-1 font-medium">Event type</th>
                    <th scope="col" className="py-1 text-right font-medium">Rows</th>
                    <th scope="col" className="py-1 text-right font-medium">Accepted</th>
                    <th scope="col" className="py-1 text-right font-medium">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.byEventType.map((e) => (
                    <tr key={e.eventType} className="border-t border-border/60">
                      <td className="py-1.5 font-mono">{e.eventType}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInt(e.rows)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ok-text">{formatInt(e.accepted)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${e.rejected ? "font-medium text-rejected-text" : "text-ink-faint"}`}>{formatInt(e.rejected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card data-testid="next-step">
          <CardHeader>
            <CardTitle>Next step</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-body text-ink">{step.text}</p>
            {step.cta && ctaHref ? (
              <Button asChild size="sm" variant="outline" disabled={step.cta.target === "update-set"}>
                <Link href={ctaHref}>{step.cta.label} →</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top findings (by rule)</CardTitle>
          </CardHeader>
          <CardContent>
            {facets.byRule.length === 0 ? (
              <p className="text-small text-ink-muted">No findings — every row passed validation.</p>
            ) : (
              <ul className="divide-y divide-border/60 text-small">
                {facets.byRule.slice(0, 6).map((r) => (
                  <li key={r.value} className="flex items-center justify-between py-1.5">
                    <Link href={`${base}/findings?ruleId=${encodeURIComponent(r.value)}`} className="font-mono text-brand hover:underline">
                      {r.value}
                    </Link>
                    <span className="tabular-nums">{formatInt(r.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-small">
            <p className="text-ink">
              {batch.originalFilename} · {formatBytes(batch.rawFile.sizeBytes)} · {batch.rawFile.encodingDetected}
              {parsedManifest?.lineCount ? ` · ${formatInt(parsedManifest.lineCount)} lines` : ""}
            </p>
            <HashChip hash={batch.fileSha256} label="sha256" truncate={12} />
            <div className="flex flex-wrap gap-2 pt-1">
              {isAdmin && batch.reports.some((r) => r.name === "manifest.json") ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/batches/${batch.batchId}/reports/manifest.json`} target="_blank" rel="noopener">
                    manifest.json
                  </a>
                </Button>
              ) : null}
              {isAdmin && batch.reports.some((r) => r.name === "header.json") ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/batches/${batch.batchId}/reports/header.json`} target="_blank" rel="noopener">
                    header.json
                  </a>
                </Button>
              ) : null}
            </div>
            <p className="text-caption text-ink-muted">Idempotency: identical bytes for the same employer return this batch instead of creating a new one.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}