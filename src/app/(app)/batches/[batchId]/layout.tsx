import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { findingFacets } from "@/lib/queries/findings";
import { canViewPrivateFindings } from "@/lib/auth/roles";
import { EMPLOYER_NAMES } from "@/lib/auth/dev-session";
import { actorLabel, formatBytes, formatDateTime, formatEmployer, shortBatchId } from "@/lib/ui/format";
import { StatusBadge } from "@/components/app/badges/status-badge";
import { BatchPoller } from "@/components/app/batch-poller";
import { CopyButton } from "@/components/app/copy-button";
import { HashChip } from "@/components/app/ledger/hash-chip";
import { PageHeader } from "@/components/app/page-header";
import { StepperTimeline } from "@/components/app/stepper-timeline";
import { RejectedCsvButton } from "@/components/app/findings/rejected-csv-button";
import { loadBatchPage } from "./_lib";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ batchId: string }> }): Promise<Metadata> {
  const { batchId } = await params;
  return { title: `${shortBatchId(batchId)} · Batches` };
}

/** docs/ux-design.md section 5.4: PageHeader + tabs + StepperTimeline + BatchPoller shared by all tabs. */
export default async function BatchLayout({ params, children }: { params: Promise<{ batchId: string }>; children: ReactNode }) {
  const { batchId } = await params;
  const { session, batch, heldCount } = await loadBatchPage(batchId);
  const ctx = await getAppContext();
  const facets = await findingFacets(ctx, batchId, canViewPrivateFindings(session));
  const reviewer = session.role !== "EmployerSubmitter";
  const base = `/batches/${batch.batchId}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{shortBatchId(batch.batchId)}</span>
            <CopyButton value={batch.batchId} label="Copy full batch id" size="sm" />
          </span>
        }
        srTitle={batch.batchId}
        breadcrumbs={[{ label: "Batches", href: "/batches" }, { label: shortBatchId(batch.batchId) }]}
        meta={[
          { label: "Status", value: <StatusBadge status={batch.status} heldCount={heldCount} /> },
          { label: "Employer", value: <span>Employer {formatEmployer(batch.employerId, EMPLOYER_NAMES[batch.employerId])}</span> },
          { label: "File", value: <span className="inline-flex items-center gap-1"><span className="max-w-[16rem] truncate" title={batch.originalFilename}>{batch.originalFilename}</span><HashChip hash={batch.fileSha256} /></span> },
          { label: "Received", value: <time dateTime={batch.receivedAt} title={batch.receivedAt}>Received {formatDateTime(batch.receivedAt)}</time> },
          { label: "Execution date", value: <span>Execution date {batch.executionDate}</span> },
          { label: "Uploaded by", value: <span>by <span className="font-mono">{actorLabel(batch.uploadedBy)}</span></span> },
          { label: "Size", value: <span>{formatBytes(batch.rawFile.sizeBytes)}</span> },
          { label: "Refresh", value: <BatchPoller batchId={batch.batchId} status={batch.status} /> },
        ]}
        actions={batch.counts.rejected > 0 ? <RejectedCsvButton batchId={batch.batchId} rejectedRows={batch.counts.rejected} size="default" /> : null}
        tabsLabel="Batch sections"
        tabs={[
          { label: "Overview", href: base },
          { label: "Findings", href: `${base}/findings`, count: facets.total },
          { label: "Records", href: `${base}/records`, count: batch.counts.rows || undefined },
          { label: "Update Set", href: `${base}/update-set`, hidden: !reviewer, disabled: true, disabledReason: "Built after validation completes · available in a later phase" },
          { label: "Reports", href: `${base}/reports`, match: "prefix" },
          { label: "Ledger", href: `/ledger?batchId=${batch.batchId}`, hidden: !reviewer },
        ]}
      />
      <StepperTimeline status={batch.status} heldCount={heldCount} history={batch.statusHistory} failureReason={batch.failureReason} />
      {children}
    </div>
  );
}