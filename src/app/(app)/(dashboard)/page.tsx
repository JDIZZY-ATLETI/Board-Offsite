import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Upload } from "lucide-react";
import { getAppContext } from "@/lib/app-context";
import { requirePageSession } from "@/lib/auth/page-session";
import { employerScope } from "@/lib/auth/roles";
import { EMPLOYER_NAMES } from "@/lib/auth/dev-session";
import { findingsByRule, getDashboardData } from "@/lib/queries/dashboard";
import { getLastVerification, getLedgerHead } from "@/lib/queries/ledger";
import { formatDateTime, formatEmployer, formatInt, formatRelative } from "@/lib/ui/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BatchMiniTable } from "@/components/app/batch-mini-table";
import { FindingsByRulePanel } from "@/components/app/findings-by-rule-panel";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { integrityState } from "@/lib/ui/integrity";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.1 (Phase 1 KPIs from available data). */
export default async function DashboardPage() {
  const session = await requirePageSession();
  const ctx = await getAppContext();
  const scope = employerScope(session);
  const isSubmitter = session.role === "EmployerSubmitter";
  // Section 5.1: the rule panel is Reviewer/Admin only; both see PRIVATE findings.
  const [data, head, last, byRule] = await Promise.all([getDashboardData(ctx, scope), getLedgerHead(ctx), getLastVerification(ctx), isSubmitter ? null : findingsByRule(ctx, { includePrivate: true })]);
  const k = data.kpis;
  const canUpload = session.role !== "Reviewer";
  const canLedger = session.role !== "EmployerSubmitter";
  const integrity = integrityState(last);
  const deltaPts = k.rejectionRate30d !== null && k.rejectionRatePrev30d !== null ? Math.round((k.rejectionRate30d - k.rejectionRatePrev30d) * 1000) / 10 : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={scope ? `Employer ${formatEmployer(scope, EMPLOYER_NAMES[scope])} · ${session.role === "EmployerSubmitter" ? "Submitter view" : ""}` : "All employers"}
        actions={
          canUpload ? (
            <Button asChild>
              <Link href="/upload">
                <Upload aria-hidden="true" /> Upload Events file
              </Link>
            </Button>
          ) : null
        }
      />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Batches today" value={k.batchesToday} status={k.inProgress > 0 ? "attention" : "neutral"} footer={`${formatInt(k.inProgress)} in progress`} href="/batches" data-testid="kpi-batches-today" />
        {isSubmitter ? (
          <StatCard label="Awaiting HOOPP review" value={k.pendingApproval} status={k.pendingApproval > 0 ? "attention" : "neutral"} footer={k.oldestPendingAt ? `oldest ${formatRelative(k.oldestPendingAt)}` : "nothing waiting"} />
        ) : (
          <StatCard label="Pending approvals" value={k.pendingApproval} status={k.pendingApproval > 0 ? "attention" : "neutral"} footer={k.oldestPendingAt ? `oldest ${formatRelative(k.oldestPendingAt)} → review` : "nothing waiting"} href="/batches?status=PENDING_APPROVAL" />
        )}
        <StatCard
          label="Rejection rate (30 d)"
          value={k.rejectionRate30d}
          format="pct"
          status={k.rejectionRate30d === null ? "neutral" : k.rejectionRate30d > 0.1 ? "bad" : k.rejectionRate30d > 0 ? "attention" : "ok"}
          delta={deltaPts !== null && deltaPts !== 0 ? { value: Math.abs(deltaPts), direction: deltaPts > 0 ? "up" : "down", good: deltaPts < 0, label: "pt vs previous 30 d" } : undefined}
          footer={`${formatInt(k.rejectedRows30d)} of ${formatInt(k.rows30d)} rows`}
        />
        <StatCard
          label="Ledger"
          value={head.seq}
          status={integrity.state === "tampered" ? "bad" : integrity.state === "ok" && !integrity.stale ? "ok" : "neutral"}
          footer={
            integrity.state === "tampered"
              ? "Integrity failure — see banner"
              : integrity.state === "ok"
                ? `${integrity.stale ? "Stale · last verified" : "Verified"} ${formatDateTime(last!.verifiedAt)}`
                : "Not verified yet"
          }
          href={canLedger ? "/ledger" : undefined}
          data-testid="kpi-ledger"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Needs attention</CardTitle>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/batches">
                View all <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <BatchMiniTable
              batches={data.needsAttention}
              caption="Batches needing attention in the last 7 days"
              showEmployer={!scope}
              relative
              hrefFor={(b) => (b.status === "FILE_REJECTED" ? `/batches/${b.batchId}/findings` : `/batches/${b.batchId}`)}
              empty={{ title: "Nothing needs attention", description: "Failed, rejected and pending batches from the last 7 days appear here." }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent batches</CardTitle>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/batches">
                View all <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <BatchMiniTable
              batches={data.recent}
              caption="Most recent batches"
              showEmployer={!scope}
              empty={
                isSubmitter
                  ? {
                      title: "No Events files yet",
                      description: "Upload a terminations, retirements or deaths file to get started.",
                      action: (
                        <Button asChild size="sm">
                          <Link href="/upload">Upload Events file</Link>
                        </Button>
                      ),
                    }
                  : { title: "No batches yet", description: "Employers haven't uploaded any Events files." }
              }
            />
          </CardContent>
        </Card>
      </div>

      {byRule ? (
        <Card data-testid="findings-by-rule">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Findings by rule</CardTitle>
              <p className="text-caption text-ink-muted">
                Last 30 days · {formatInt(byRule.totalFindings)} findings across {formatInt(byRule.batches)} batches · top {byRule.items.length}
              </p>
            </div>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="/admin/rules">
                Rule registry <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <FindingsByRulePanel items={byRule.items} totalFindings={byRule.totalFindings} batches={byRule.batches} />
          </CardContent>
        </Card>
      ) : null}

      <p className="text-caption text-ink-faint">
        Refreshed {formatDateTime(data.generatedAt, { seconds: true })} ·{" "}
        <Link href="/" className="underline-offset-2 hover:underline">
          Refresh
        </Link>
      </p>
    </div>
  );
}