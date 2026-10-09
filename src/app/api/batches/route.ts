import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { json, parseQuery, withApi } from "@/lib/api/handler";
import { limitSchema } from "@/lib/api/pagination";
import { canAccessEmployer, employerScope } from "@/lib/auth/roles";
import { requireRole, requireSession } from "@/lib/auth/session";
import { looksLikeBinary } from "@/lib/events/decode";
import { ingest } from "@/lib/pipeline/ingest";
import { getJobRunner } from "@/lib/pipeline/jobs";
import { runBatch } from "@/lib/pipeline/run";
import { listBatches } from "@/lib/queries/batches";
import { BATCH_STATUSES, SOURCE_SYSTEMS, type IsoDate } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuery = z.object({
  status: z.enum(BATCH_STATUSES).optional(),
  employerId: z.string().min(1).max(32).optional(),
  cursor: z.string().uuid().optional(),
  limit: limitSchema,
});

export const GET = withApi(async (_req, { app, session, url }) => {
  const s = requireSession(session);
  const q = parseQuery(url, listQuery);
  const page = await listBatches(app, { ...q, scopeEmployerId: employerScope(s) });
  return json(page);
});

const uploadFields = z.object({
  employerId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, "employerId must be 1-32 alphanumeric characters"),
  executionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sourceSystem: z.enum(SOURCE_SYSTEMS).optional(),
});

const ALLOWED_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "application/octet-stream", "text/plain", ""]);

export const POST = withApi(async (req, { app, session, url, log }) => {
  const s = requireRole(session, "EmployerSubmitter", "Admin");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "INVALID_MULTIPART", "expected multipart/form-data with a `file` part");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ApiError(400, "FILE_REQUIRED", "`file` part is required");
  const fields = uploadFields.safeParse({
    employerId: form.get("employerId") ?? s.employerId ?? undefined,
    executionDate: form.get("executionDate") ?? undefined,
    sourceSystem: form.get("sourceSystem") ?? undefined,
  });
  if (!fields.success) throw new ApiError(400, "VALIDATION_ERROR", "invalid upload fields", fields.error.issues);
  const { employerId, executionDate, sourceSystem } = fields.data;
  if (!canAccessEmployer(s, employerId)) throw new ApiError(403, "FORBIDDEN", "you may only upload for your own employer");
  if (executionDate && s.role !== "Admin") throw new ApiError(403, "FORBIDDEN", "only Admin may override executionDate");

  const filename = (file instanceof File ? file.name : "upload.csv") || "upload.csv";
  const contentType = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType) || !filename.toLowerCase().endsWith(".csv")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "file must be a .csv (text/csv)");
  }
  if (file.size > app.config.maxUploadBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", `file exceeds ${app.config.maxUploadBytes} bytes`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = looksLikeBinary(bytes);
  if (kind) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", `file looks like a ${kind} archive/binary, not CSV`);
  let lines = 0;
  let longest = 0;
  let run = 0;
  for (const b of bytes) {
    if (b === 0x0a) {
      lines += 1;
      longest = Math.max(longest, run);
      run = 0;
    } else run += 1;
  }
  longest = Math.max(longest, run);
  if (lines > app.config.maxUploadRows + 1) throw new ApiError(413, "TOO_MANY_ROWS", `file exceeds ${app.config.maxUploadRows} rows`);
  if (longest > app.config.maxLineLength) throw new ApiError(413, "LINE_TOO_LONG", `a line exceeds ${app.config.maxLineLength} bytes`);

  const result = await ingest(app, { bytes, filename, employerId, submittedBy: s.actor, executionDate: executionDate as IsoDate | undefined, sourceSystem, contentType: contentType || "text/csv" });
  if (result.duplicate) return json({ batchId: result.batchId, duplicate: true, sha256: result.sha256 }, { status: 200 });

  const wait = url.searchParams.get("wait") === "true";
  if (wait) {
    const status = await runBatch(app, result.batchId);
    return json({ batchId: result.batchId, status, duplicate: false, sha256: result.sha256 }, { status: 200 });
  }
  const runner = await getJobRunner();
  await runner.enqueue({ batchId: result.batchId });
  log.info({ batchId: result.batchId }, "batch enqueued");
  return json({ batchId: result.batchId, status: "RECEIVED", duplicate: false, sha256: result.sha256 }, { status: 202 });
});
