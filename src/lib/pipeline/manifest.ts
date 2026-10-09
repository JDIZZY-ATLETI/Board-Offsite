import { z } from "zod";

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().uuid(),
  employerId: z.string().min(1),
  fileType: z.literal("EVENTS"),
  sourceSystem: z.string(),
  originalFilename: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  uploadedBy: z.string(),
  receivedAt: z.string(),
  executionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contentType: z.string(),
  encodingDetected: z.string(),
  lineCount: z.number().int().nonnegative(),
  retention: z.object({ class: z.string(), deleteNotBefore: z.string() }),
});

export type Manifest = z.infer<typeof manifestSchema>;
