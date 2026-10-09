import { z } from "zod";

export const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!cursor) return null;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
