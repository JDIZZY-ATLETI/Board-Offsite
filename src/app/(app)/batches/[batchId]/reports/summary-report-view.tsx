import Link from "next/link";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/ui/format";
import { summarizeFindings, type SummaryRow } from "@/lib/pipeline/summary-report";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityBadge } from "@/components/app/badges/severity-badge";
import { EmptyState } from "@/components/app/empty-state";
import type { Batch, FindingSeverity, ValidationFinding } from "@/types";

export interface SummaryReportViewProps {
  batch: Batch;
  findings: ValidationFinding[];
  /** Private variant: PRIVATE / SYS findings included, Visibility column with Lock tags (Reviewer/Admin). */
  includePrivate: boolean;
}

/**
 * docs/ux-design.md section 5.4.5 "Summary of validations": table by message id - Rule · Message ID · Severity ·
 * Count · Overridden · Portal message, with a second "File-format findings" section. Same rows as the CSV.
 */
export function SummaryReportView({ batch, findings, includePrivate }: SummaryReportViewProps) {
  const rows = summarizeFindings(findings, includePrivate);
  const base = `/batches/${batch.batchId}`;
  const csvName = includePrivate ? "summary-of-validations.private.csv" : "summary-of-validations.csv";
  const business = rows.filter((r) => r.section === "BUSINESS");
  const fileFormat = rows.filter((r) => r.section === "FILE_FORMAT");
  const totals = rows.reduce((a, r) => ({ findings: a.findings + r.findings, overridden: a.overridden + r.overridden }), { findings: 0, overridden: 0 });

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
            <a href={`/api/batches/${batch.batchId}/reports/${csvName}`} download>
              <Download aria-hidden="true" /> Download CSV
            </a>
          </Button>
          {includePrivate ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`${base}/reports/summary-of-validations.csv`}>Public version</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Summary of validations
            {includePrivate ? (
              <span className="inline-flex items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-caption font-medium text-ink-muted">
                <Lock aria-hidden="true" className="h-3 w-3" /> incl. HOOPP-internal
              </span>
            ) : null}
            <span className="text-caption font-normal text-ink-faint">Legacy: {includePrivate ? "D0000typ.xlsx / D0000ctl" : "D0000Val.xls"}</span>
          </CardTitle>
          <CardDescription>
            {formatInt(totals.findings)} finding{totals.findings === 1 ? "" : "s"} across {formatInt(rows.length)} message id{rows.length === 1 ? "" : "s"} · {formatInt(totals.overridden)} overridden
            {includePrivate ? " · HOOPP-internal rows carry a Lock tag and never appear in the public CSV." : ". HOOPP-internal findings are not included."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-0">
          {rows.length === 0 ? (
            <EmptyState illustration="shield" title="No findings" description="Every row passed validation." compact />
          ) : (
            <div data-testid="summary-report-table">
              <SummarySection title="Business rules (L2)" rows={business} includePrivate={includePrivate} base={base} />
              <SummarySection title="File-format findings (L0 / L1)" rows={fileFormat} includePrivate={includePrivate} base={base} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummarySection({ title, rows, includePrivate, base }: { title: string; rows: SummaryRow[]; includePrivate: boolean; base: string }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="px-5 text-h3">
        {title} <span className="text-small font-normal text-ink-muted">({formatInt(rows.length)})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="px-5 text-small text-ink-muted">None.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <caption className="sr-only">{title}: findings grouped by rule and message id</caption>
            <thead>
              <tr className="border-b border-border text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2 font-medium">Rule</th>
                <th scope="col" className="px-3 py-2 font-medium">Message ID</th>
                <th scope="col" className="px-3 py-2 font-medium">Severity</th>
                {includePrivate ? <th scope="col" className="px-3 py-2 font-medium">Visibility</th> : null}
                <th scope="col" className="px-3 py-2 text-right font-medium">Count</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Rows</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Overridden</th>
                <th scope="col" className="px-5 py-2 font-medium">Portal message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ruleId}|${r.messageId}`} className={cn("border-b border-border/60 last:border-0", r.visibility === "PRIVATE" && "bg-surface/60")} data-visibility={r.visibility} data-testid={`summary-row-${r.ruleId}-${r.messageId}`}>
                  <td className="px-5 py-1.5 font-mono">
                    <Link href={`${base}/findings?ruleId=${encodeURIComponent(r.ruleId)}&group=severity`} className="underline-offset-2 hover:underline">
                      {r.ruleId}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-caption">{r.messageId}</td>
                  <td className="px-3 py-1.5">
                    <SeverityBadge severity={r.severity as FindingSeverity} size="sm" short />
                  </td>
                  {includePrivate ? (
                    <td className="px-3 py-1.5">
                      {r.visibility === "PRIVATE" ? (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-caption font-medium text-ink-muted">
                          <Lock aria-hidden="true" className="h-3 w-3" /> HOOPP-internal
                        </span>
                      ) : (
                        <span className="text-caption text-ink-muted">Public</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatInt(r.findings)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(r.rows)}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", r.overridden ? "font-medium text-held-text" : "text-ink-faint")}>{formatInt(r.overridden)}</td>
                  <td className="max-w-xl whitespace-normal px-5 py-1.5 text-ink">{r.portalMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}