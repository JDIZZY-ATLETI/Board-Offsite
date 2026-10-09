import { and, eq, ne } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { sha256Hex } from "@/lib/crypto/hash";
import { batches, batchStatusHistory, rawFiles } from "@/lib/db/schema";
import { decodeBytes } from "@/lib/events/decode";
import { lakePaths } from "@/lib/lake/paths";
import { batchStream } from "@/lib/ledger/streams";
import { todayIso } from "@/lib/events/fields";
import type { BatchReceivedPayload, IsoDate, SourceSystem } from "@/types";
import type { Manifest } from "./manifest";

export interface IngestInput {
  bytes: Buffer;
  filename: string;
  employerId: string;
  /** Actor string, e.g. "user:es-0235-jsmith". */
  submittedBy: string;
  executionDate?: IsoDate;
  sourceSystem?: SourceSystem;
  contentType?: string;
}

export type IngestResult =
  | { duplicate: true; batchId: string; sha256: string }
  | { duplicate: false; batchId: string; status: "RECEIVED"; sha256: string; executionDate: IsoDate };

const RETENTION_YEARS = 7;

export async function findExistingBatch(ctx: AppContext, employerId: string, sha256: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ batchId: batches.batchId })
    .from(batches)
    .where(and(eq(batches.employerId, employerId), eq(batches.fileSha256, sha256), ne(batches.status, "FILE_REJECTED")))
    .limit(1);
  return row?.batchId ?? null;
}

/** Architecture section 10.2 `ingest` + section 10.3 idempotency. */
export async function ingest(ctx: AppContext, input: IngestInput): Promise<IngestResult> {
  const sha256 = sha256Hex(input.bytes);
  const now = ctx.clock();
  const receivedAt = now.toISOString();
  const executionDate = input.executionDate ?? todayIso(now);
  const sourceSystem = input.sourceSystem ?? "HOOPP_CSV";
  const basePayload: BatchReceivedPayload = {
    employerId: input.employerId,
    originalFilename: input.filename,
    sha256,
    sizeBytes: input.bytes.length,
    executionDate,
    uploadedBy: input.submittedBy,
  };

  const existing = await findExistingBatch(ctx, input.employerId, sha256);
  if (existing) {
    await ctx.ledger.append({
      streamId: batchStream(existing),
      eventType: "BatchReceived",
      batchId: existing,
      actor: input.submittedBy,
      payload: { ...basePayload, duplicateOf: existing },
    });
    ctx.logger.info({ batchId: existing, sha256 }, "duplicate upload: returning existing batch");
    return { duplicate: true, batchId: existing, sha256 };
  }

  const batchId = ctx.newId();
  const rawFileId = ctx.newId();
  const { encoding, text } = decodeBytes(input.bytes);
  const lineCount = text === "" ? 0 : text.split(/\r\n|\n|\r/).filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
  const paths = lakePaths({ employerId: input.employerId, batchId, ingestDate: receivedAt.slice(0, 10) as IsoDate });
  const manifest: Manifest = {
    schemaVersion: 1,
    batchId,
    employerId: input.employerId,
    fileType: "EVENTS",
    sourceSystem,
    originalFilename: input.filename,
    sha256,
    sizeBytes: input.bytes.length,
    uploadedBy: input.submittedBy,
    receivedAt,
    executionDate,
    contentType: input.contentType ?? "text/csv",
    encodingDetected: encoding,
    lineCount,
    retention: {
      class: "regulatory",
      deleteNotBefore: `${now.getUTCFullYear() + RETENTION_YEARS}${receivedAt.slice(4, 10)}`,
    },
  };

  await ctx.lake.put(paths.raw.original, input.bytes, { contentType: "text/csv" });
  await ctx.lake.put(paths.raw.manifest, JSON.stringify(manifest, null, 2), { contentType: "application/json" });

  try {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(rawFiles).values({
        rawFileId,
        originalFilename: input.filename,
        sha256,
        sizeBytes: input.bytes.length,
        encodingDetected: encoding,
        lakePath: paths.raw.original,
        receivedAt,
      });
      await tx.insert(batches).values({
        batchId,
        employerId: input.employerId,
        fileType: "EVENTS",
        sourceSystem,
        status: "RECEIVED",
        executionDate,
        rawFileId,
        fileSha256: sha256,
        uploadedBy: input.submittedBy,
        receivedAt,
        updatedAt: receivedAt,
      });
      await tx.insert(batchStatusHistory).values({ batchId, fromStatus: null, toStatus: "RECEIVED", actor: input.submittedBy, at: receivedAt, note: "upload stored in raw zone" });
      await ctx.ledger.append({ streamId: batchStream(batchId), eventType: "BatchReceived", batchId, actor: input.submittedBy, payload: { ...basePayload } }, tx);
    });
  } catch (err) {
    // Lost a race with an identical upload: the partial unique index rejected us.
    const again = await findExistingBatch(ctx, input.employerId, sha256);
    if (again) return { duplicate: true, batchId: again, sha256 };
    throw err;
  }
  ctx.logger.info({ batchId, employerId: input.employerId, sha256, sizeBytes: input.bytes.length, encoding }, "batch received");
  return { duplicate: false, batchId, status: "RECEIVED", sha256, executionDate };
}
