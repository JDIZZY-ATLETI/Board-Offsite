import type { AppContext } from "@/lib/app-context";
import { auditLog } from "@/lib/db/schema";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import type { Batch, Session } from "@/types";
import { reportPath } from "./batches";

export const REPORT_NAMES = [
  "execution-report.json",
  "execution-report.html",
  "rejected.csv",
  "findings.ndjson",
  "accepted.ndjson",
  "records.ndjson",
  "header.json",
  "manifest.json",
  "summary-of-validations.csv",
  "summary-of-validations.private.csv",
  "ariel-snapshot.ndjson",
  "rules-config.json",
  "ariel-update-set.json",
  "ariel-update-set.csv",
  "diff.md",
  "modified-fields-report.csv",
  "transactions-report.csv",
  "transactions-summary.csv",
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export const REPORT_CONTENT_TYPES: Record<ReportName, string> = {
  "execution-report.json": "application/json; charset=utf-8",
  "execution-report.html": "text/html; charset=utf-8",
  "rejected.csv": "text/csv",
  "findings.ndjson": "application/x-ndjson; charset=utf-8",
  "accepted.ndjson": "application/x-ndjson; charset=utf-8",
  "records.ndjson": "application/x-ndjson; charset=utf-8",
  "header.json": "application/json; charset=utf-8",
  "manifest.json": "application/json; charset=utf-8",
  "summary-of-validations.csv": "text/csv; charset=utf-8",
  "summary-of-validations.private.csv": "text/csv; charset=utf-8",
  "ariel-snapshot.ndjson": "application/x-ndjson; charset=utf-8",
  "rules-config.json": "application/json; charset=utf-8",
  "ariel-update-set.json": "application/json; charset=utf-8",
  "ariel-update-set.csv": "text/csv; charset=utf-8",
  "diff.md": "text/markdown; charset=utf-8",
  "modified-fields-report.csv": "text/csv; charset=utf-8",
  "transactions-report.csv": "text/csv; charset=utf-8",
  "transactions-summary.csv": "text/csv; charset=utf-8",
};

/** Reviewer/Admin only (architecture section 10.6: Control Report content). */
export const PRIVATE_REPORTS: ReadonlySet<ReportName> = new Set<ReportName>([
  "summary-of-validations.private.csv",
  "ariel-snapshot.ndjson",
  "rules-config.json",
  // Phase 3: derived Ariel changes are HOOPP-internal (section 13.1; UX section 5.4.5 roles column).
  "ariel-update-set.json",
  "ariel-update-set.csv",
  "diff.md",
  "modified-fields-report.csv",
  "transactions-report.csv",
  "transactions-summary.csv",
]);

/** Artifacts whose download must be audit-logged because they contain raw SIN. */
export const PII_REPORTS: ReadonlySet<ReportName> = new Set<ReportName>(["rejected.csv"]);

export async function readReport(ctx: AppContext, batch: Batch, name: ReportName): Promise<{ bytes: Buffer; contentType: string; path: string } | null> {
  const paths = lakePaths({ employerId: batch.employerId, batchId: batch.batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  const path = reportPath(paths, name);
  if (!(await ctx.lake.exists(path))) return null;
  return { bytes: await ctx.lake.get(path), contentType: REPORT_CONTENT_TYPES[name], path };
}

export async function auditPiiDownload(ctx: AppContext, session: Session, batchId: string, name: ReportName, ip: string | null): Promise<void> {
  await ctx.db.insert(auditLog).values({
    at: ctx.clock().toISOString(),
    actor: session.actor,
    role: session.role,
    action: "DOWNLOAD_PII_REPORT",
    target: `batch:${batchId}/${name}`,
    ip: ip && /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null,
    details: { report: name },
  });
}
