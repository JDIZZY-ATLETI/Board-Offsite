import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAppContext } from "@/lib/app-context";
import { canViewPrivateFindings } from "@/lib/auth/roles";
import { listFindings } from "@/lib/queries/findings";
import { readReport } from "@/lib/queries/reports";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import type { ValidationFinding } from "@/types";
import { loadBatchPage } from "../../_lib";
import { ExecutionReportView } from "../execution-report-view";
import { SummaryReportView } from "../summary-report-view";

export const dynamic = "force-dynamic";

const VIEWS = ["execution-report", "summary-of-validations.csv", "summary-of-validations.private.csv"] as const;
type ViewName = (typeof VIEWS)[number];

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  return { title: name === "execution-report" ? "Execution report" : name.includes("private") ? "Summary of validations (incl. HOOPP-internal)" : "Summary of validations" };
}

/** In-app report views (docs/ux-design.md section 5.4.5): Execution report, Summary of validations (public / private). */
export default async function ReportViewPage({ params }: { params: Promise<{ batchId: string; name: string }> }) {
  const { batchId, name } = await params;
  if (!(VIEWS as readonly string[]).includes(name)) notFound();
  const view = name as ViewName;
  const { session, batch } = await loadBatchPage(batchId);
  const ctx = await getAppContext();
  const base = `/batches/${batch.batchId}`;

  if (view === "execution-report") {
    const file = await readReport(ctx, batch, "execution-report.json");
    if (!file) {
      return <EmptyState illustration="inbox" title="Execution report not generated yet" description="It is written when processing finishes." action={<Button asChild variant="outline"><Link href={`${base}/reports`}>Back to Reports</Link></Button>} />;
    }
    return <ExecutionReportView batch={batch} file={file} />;
  }

  const includePrivate = view === "summary-of-validations.private.csv";
  // Hidden cards are also server-enforced: the private variant is Reviewer/Admin only (architecture 10.6).
  if (includePrivate && !canViewPrivateFindings(session)) redirect("/forbidden");
  if (batch.status === "RECEIVED" || batch.status === "PARSED") {
    return <EmptyState illustration="inbox" title="Summary of validations not available yet" description="It is produced when validation finishes." action={<Button asChild variant="outline"><Link href={`${base}/reports`}>Back to Reports</Link></Button>} />;
  }
  const findings: ValidationFinding[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: ValidationFinding[]; nextCursor: string | null } = await listFindings(ctx, batchId, { includePrivate, cursor, limit: 200 });
    findings.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return <SummaryReportView batch={batch} findings={findings} includePrivate={includePrivate} />;
}