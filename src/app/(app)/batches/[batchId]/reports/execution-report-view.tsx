import Link from "next/link";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { formatBytes, formatDateTime, formatDuration, formatInt } from "@/lib/ui/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HashChip } from "@/components/app/ledger/hash-chip";
import { StatusBadge } from "@/components/app/badges/status-badge";
import type { Batch, ExecutionReport } from "@/types";

/** In-app Execution report view (docs/ux-design.md section 5.4.5, legacy D0000dti.html). */
export function ExecutionReportView({ batch, file }: { batch: Batch; file: { bytes: Buffer } }) {
  const base = `/batches/${batch.batchId}`;
  const r = JSON.parse(file.bytes.toString("utf8")) as ExecutionReport;
  const rules = [...r.rules].sort((a, b) => b.durationMs - a.durationMs);
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <StatusBadge key="s" status={r.status} size="sm" />],
    ["Started", formatDateTime(r.startedAt, { seconds: true })],
    ["Ended", formatDateTime(r.endedAt, { seconds: true })],
    ["Duration", formatDuration(r.durationMs)],
    ["Employer", r.parameters.employerId],
    ["Execution date", r.parameters.executionDate],
    ["Source system", r.parameters.sourceSystem],
    ["Uploaded by", <span key="u" className="font-mono">{r.parameters.uploadedBy}</span>],
    ["Rules config hash", <HashChip key="h" hash={r.parameters.rulesConfigHash} truncate={12} />],
    ["Input file", `${r.input.originalFilename} · ${formatBytes(r.input.sizeBytes)} · ${r.input.encodingDetected} · ${formatInt(r.input.lineCount)} lines`],
    ["Input sha256", <HashChip key="i" hash={r.input.sha256} truncate={12} />],
  ];
  const counts: Array<[string, number]> = [
    ["Lines read", r.counts.linesRead],
    ["Rows", r.counts.rows],
    ["Accepted", r.counts.accepted],
    ["Rejected", r.counts.rejected],
    ["File errors", r.counts.fileErrors],
    ["Member errors", r.counts.memberErrors],
    ["Warnings", r.counts.warnings],
    ["Infos", r.counts.infos],
    ["Findings", r.counts.findings],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`${base}/reports`}>
            <ArrowLeft aria-hidden="true" /> Reports
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/batches/${batch.batchId}/reports/execution-report.html`} target="_blank" rel="noopener">
              <ExternalLink aria-hidden="true" /> Open HTML
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/batches/${batch.batchId}/reports/execution-report.json`} target="_blank" rel="noopener">
              <Download aria-hidden="true" /> JSON
            </a>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Execution report <span className="text-caption font-normal text-ink-faint">Legacy: D0000dti.html</span></CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {r.failureReason ? <p className="mt-3 rounded-sm bg-sev-cme-soft p-2 font-mono text-caption text-sev-cme-text">{r.failureReason}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3 text-small">
              {counts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-caption text-ink-muted">{k}</dt>
                  <dd className="text-h2 tabular-nums">{formatInt(v)}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-4 text-h3">Outputs</h3>
            <ul className="mt-1 space-y-0.5 font-mono text-caption text-ink-muted">
              {r.outputs.map((o) => (
                <li key={o} className="truncate" title={o}>
                  {o}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rule timing</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <table className="w-full text-small">
            <caption className="sr-only">Per-rule evaluations, findings and duration, slowest first</caption>
            <thead>
              <tr className="border-b border-border text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2 font-medium">Rule</th>
                <th scope="col" className="px-3 py-2 font-medium">Level</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Evaluations</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Findings</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Skipped</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((t) => (
                <tr key={t.ruleId} className="border-b border-border/60 last:border-0">
                  <td className="px-5 py-1.5 font-mono">{t.ruleId}</td>
                  <td className="px-3 py-1.5">{t.level}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(t.evaluations)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${t.findings ? "font-medium" : "text-ink-faint"}`}>{formatInt(t.findings)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${t.skipped ? "text-held-text" : "text-ink-faint"}`} title={t.skipped ? "Rows where an input (e.g. a rate-table year) was unavailable; see ruleSkips in the JSON" : undefined}>{formatInt(t.skipped ?? 0)}</td>
                  <td className="px-5 py-1.5 text-right tabular-nums">{formatDuration(t.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
