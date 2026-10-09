import type { AppContext } from "@/lib/app-context";
import { auditLog } from "@/lib/db/schema";
import { lakePaths } from "@/lib/lake/paths";
import type { Batch, IsoDate, Session } from "@/types";
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
};

/** Artifacts whose download must be audit-logged because they contain raw SIN. */
export const PII_REPORTS: ReadonlySet<ReportName> = new Set<ReportName>(["rejected.csv"]);

export async function readReport(ctx: AppContext, batch: Batch, name: ReportName): Promise<{ bytes: Buffer; contentType: string; path: string } | null> {
  const paths = lakePaths({ employerId: batch.employerId, batchId: batch.batchId, ingestDate: batch.receivedAt.slice(0, 10) as IsoDate });
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
