import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { batches, batchStatusHistory, rawFiles } from "@/lib/db/schema";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import type { Batch, BatchStatus, BatchStatusHistoryEntry, IsoDate, RawFile, SourceSystem } from "@/types";
import { REPORT_NAMES, type ReportName } from "./reports";

type BatchRow = typeof batches.$inferSelect;

export function toBatch(r: BatchRow): Batch {
  return {
    batchId: r.batchId,
    employerId: r.employerId,
    fileType: "EVENTS",
    sourceSystem: r.sourceSystem as SourceSystem,
    status: r.status,
    executionDate: r.executionDate as IsoDate,
    rawFileId: r.rawFileId,
    uploadedBy: r.uploadedBy,
    receivedAt: new Date(r.receivedAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    counts: { rows: r.rowsTotal, accepted: r.rowsAccepted, rejected: r.rowsRejected, warnings: r.warningsTotal, infos: r.infosTotal, held: r.heldTotal },
    ...(r.failureReason ? { failureReason: r.failureReason } : {}),
    fileSha256: r.fileSha256,
    rulesConfigHash: r.rulesConfigHash,
    arielSnapshotHash: r.arielSnapshotHash,
    arielAdapter: r.arielAdapter,
  };
}

export function toRawFile(r: typeof rawFiles.$inferSelect): RawFile {
  return {
    rawFileId: r.rawFileId,
    originalFilename: r.originalFilename,
    sha256: r.sha256,
    sizeBytes: Number(r.sizeBytes),
    encodingDetected: r.encodingDetected as RawFile["encodingDetected"],
    lakePath: r.lakePath,
    receivedAt: new Date(r.receivedAt).toISOString(),
  };
}

export interface BatchSummary extends Batch {
  originalFilename: string;
}

export interface ListBatchesParams {
  status?: BatchStatus;
  employerId?: string;
  /** Hard scope applied for EmployerSubmitter sessions. */
  scopeEmployerId?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Newest first; batch ids are UUID v7 so they order by time and double as the cursor. */
export async function listBatches(ctx: AppContext, p: ListBatchesParams): Promise<{ items: BatchSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const conds = [];
  if (p.status) conds.push(eq(batches.status, p.status));
  if (p.scopeEmployerId) conds.push(eq(batches.employerId, p.scopeEmployerId));
  else if (p.employerId) conds.push(eq(batches.employerId, p.employerId));
  if (p.cursor) conds.push(lt(batches.batchId, p.cursor));
  const rows = await ctx.db
    .select({ b: batches, filename: rawFiles.originalFilename })
    .from(batches)
    .innerJoin(rawFiles, eq(rawFiles.rawFileId, batches.rawFileId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(batches.batchId))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map((r) => ({ ...toBatch(r.b), originalFilename: r.filename }));
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].batchId : null };
}

export interface BatchDetail extends BatchSummary {
  rawFile: RawFile;
  statusHistory: BatchStatusHistoryEntry[];
  reports: Array<{ name: ReportName; path: string }>;
}

export async function getBatchDetail(ctx: AppContext, batchId: string): Promise<BatchDetail | null> {
  const [row] = await ctx.db
    .select({ b: batches, f: rawFiles })
    .from(batches)
    .innerJoin(rawFiles, eq(rawFiles.rawFileId, batches.rawFileId))
    .where(eq(batches.batchId, batchId));
  if (!row) return null;
  const history = await ctx.db.select().from(batchStatusHistory).where(eq(batchStatusHistory.batchId, batchId)).orderBy(asc(batchStatusHistory.id));
  const batch = toBatch(row.b);
  const paths = lakePaths({ employerId: batch.employerId, batchId, ingestDate: ingestDateOf(batch.receivedAt) });
  const candidates: Array<{ name: ReportName; path: string }> = REPORT_NAMES.map((name) => ({ name, path: reportPath(paths, name) }));
  const reports: Array<{ name: ReportName; path: string }> = [];
  for (const c of candidates) if (await ctx.lake.exists(c.path)) reports.push(c);
  return {
    ...batch,
    originalFilename: row.f.originalFilename,
    rawFile: toRawFile(row.f),
    statusHistory: history.map((h) => ({
      id: h.id,
      batchId: h.batchId,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actor: h.actor,
      at: new Date(h.at).toISOString(),
      note: h.note,
    })),
    reports,
  };
}

export function reportPath(paths: ReturnType<typeof lakePaths>, name: ReportName): string {
  switch (name) {
    case "execution-report.json":
      return paths.gold.executionReportJson;
    case "execution-report.html":
      return paths.gold.executionReportHtml;
    case "rejected.csv":
      return paths.silver.rejected;
    case "findings.ndjson":
      return paths.silver.findings;
    case "accepted.ndjson":
      return paths.silver.accepted;
    case "records.ndjson":
      return paths.bronze.records;
    case "header.json":
      return paths.bronze.header;
    case "manifest.json":
      return paths.raw.manifest;
    case "summary-of-validations.csv":
      return paths.gold.summaryOfValidations;
    case "summary-of-validations.private.csv":
      return paths.gold.summaryOfValidationsPrivate;
    case "ariel-snapshot.ndjson":
      return paths.silver.arielSnapshot;
    case "rules-config.json":
      return paths.silver.rulesConfig;
  }
}
