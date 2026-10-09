import type { Metadata } from "next";
import Link from "next/link";
import { Download, ExternalLink, Eye, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert } from "@/components/app/alert";
import { RejectedCsvButton } from "@/components/app/findings/rejected-csv-button";
import type { ReportName } from "@/lib/queries/reports";
import type { Role } from "@/types";
import { loadBatchPage } from "../_lib";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

interface ReportCardDef {
  key: string;
  title: string;
  legacy: string;
  description: string;
  roles: Role[];
  /** Phase 1 artifacts backing this card, if any. */
  artifacts?: ReportName[];
  viewHref?: (base: string) => string;
  laterPhase?: number;
  pii?: boolean;
}

const ALL: Role[] = ["EmployerSubmitter", "Reviewer", "Admin"];
const REVIEW: Role[] = ["Reviewer", "Admin"];

/** docs/ux-design.md section 5.4.5: legacy names map to our artifacts so legacy users find what they know. */
const CARDS: ReportCardDef[] = [
  { key: "execution", title: "Execution report", legacy: "D0000dti.html", description: "Start/end, parameters, input sha256, counts and per-rule timing.", roles: ALL, artifacts: ["execution-report.html", "execution-report.json"], viewHref: (b) => `${b}/reports/execution-report` },
  { key: "summary", title: "Summary of validations", legacy: "D0000Val.xls", description: "Findings by message id: rule, severity, count, Portal message.", roles: ALL, laterPhase: 2 },
  { key: "summary-private", title: "Summary of validations (incl. HOOPP-internal)", legacy: "D0000typ.xlsx / D0000ctl", description: "Same, with the Visibility column and HOOPP-internal findings.", roles: REVIEW, laterPhase: 2 },
  { key: "rejected", title: "Rejected individuals", legacy: "Rejected_FileName.csv", description: "The rejected rows in the original 15-column layout, ready to fix and re-upload.", roles: ALL, artifacts: ["rejected.csv"], pii: true },
  { key: "modified", title: "Modified fields report", legacy: "D0000upd.xlsx", description: "One row per derived field: file value, previous value, resulting value, derivation rule.", roles: REVIEW, laterPhase: 3 },
  { key: "transactions", title: "Transactions report", legacy: "D0000tra.xlsx", description: "Service, contribution, salary-rate and PA items per member.", roles: REVIEW, laterPhase: 3 },
  { key: "summary-tx", title: "Summary transactions", legacy: "D0000sta.xlsx", description: "Totals by record and transaction type.", roles: REVIEW, laterPhase: 3 },
  { key: "membership", title: "Membership reconciliation", legacy: "D0000mov.xls", description: "Members whose status changes, with before/after.", roles: REVIEW, laterPhase: 4 },
  { key: "person", title: "Person data change", legacy: "D0000dci.xls", description: "Last values passed per member for portal display.", roles: REVIEW, laterPhase: 4 },
  { key: "interface", title: "Interface file (original)", legacy: "FileName.csv", description: "Manifest of the file as received (sha256, size, encoding).", roles: ["Admin"], artifacts: ["manifest.json"] },
];

export default async function ReportsPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const { session, batch } = await loadBatchPage(batchId);
  const base = `/batches/${batch.batchId}`;
  const available = new Set(batch.reports.map((r) => r.name));
  const fileRejected = batch.status === "FILE_REJECTED";
  const early = batch.status === "RECEIVED" || batch.status === "PARSED";

  return (
    <div className="space-y-4">
      {fileRejected ? (
        <Alert variant="info" title="Only the Execution report exists for this batch">
          The file was rejected before rows were validated, so no row-level reports were produced.
        </Alert>
      ) : early ? (
        <Alert variant="info" title="Reports appear as the batch progresses">
          The Execution report is available now; others after validation.
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.filter((c) => c.roles.includes(session.role)).map((c) => {
          const have = (c.artifacts ?? []).filter((a) => available.has(a));
          const later = c.laterPhase !== undefined;
          const ready = !later && have.length > 0;
          const disabledReason = later ? "Available in a later phase" : fileRejected ? "Not produced — the file was rejected" : "Available after validation";
          return (
            <Card key={c.key} className={cn(!ready && "border-dashed bg-surface")} data-testid={`report-card-${c.key}`}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2 text-h3">
                  <span>{c.title}</span>
                  {c.pii ? <Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" /> : null}
                </CardTitle>
                <CardDescription>
                  <span className="block text-caption text-ink-faint">Legacy: {c.legacy}</span>
                  {c.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {!ready ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button size="sm" variant="outline" disabled>
                          {later ? `Phase ${c.laterPhase}` : "Not yet available"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{disabledReason}</TooltipContent>
                  </Tooltip>
                ) : c.key === "rejected" ? (
                  <RejectedCsvButton batchId={batch.batchId} rejectedRows={batch.counts.rejected} />
                ) : (
                  <>
                    {c.viewHref ? (
                      <Button asChild size="sm">
                        <Link href={c.viewHref(base)}>
                          <Eye aria-hidden="true" /> View
                        </Link>
                      </Button>
                    ) : null}
                    {have.map((a) => (
                      <Button key={a} asChild size="sm" variant="outline">
                        <a href={`/api/batches/${batch.batchId}/reports/${a}`} target={a.endsWith(".html") || a.endsWith(".json") ? "_blank" : undefined} rel="noopener">
                          {a.endsWith(".html") ? <ExternalLink aria-hidden="true" /> : <Download aria-hidden="true" />}
                          {a.endsWith(".html") ? "Open HTML" : a.endsWith(".json") ? "JSON" : a}
                        </a>
                      </Button>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}