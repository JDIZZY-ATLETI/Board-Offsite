import { z } from "zod";
import { json, parseQuery, withApi } from "@/lib/api/handler";
import { limitSchema } from "@/lib/api/pagination";
import { requireRole } from "@/lib/auth/session";
import { listLedgerEntries } from "@/lib/queries/ledger";
import { LEDGER_EVENT_TYPES } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({
  streamId: z.string().min(1).max(200).optional(),
  streamKind: z.enum(["batch", "member", "system"]).optional(),
  batchId: z.string().uuid().optional(),
  eventType: z.enum(LEDGER_EVENT_TYPES as [string, ...string[]]).optional(),
  fromSeq: z.coerce.number().int().positive().optional(),
  toSeq: z.coerce.number().int().positive().optional(),
  cursor: z.coerce.number().int().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: limitSchema,
});

export const GET = withApi(async (_req, { app, session, url }) => {
  requireRole(session, "Reviewer", "Admin");
  const q = parseQuery(url, query);
  const page = await listLedgerEntries(app, {
    ...q,
    eventType: q.eventType as (typeof LEDGER_EVENT_TYPES)[number] | undefined,
    cursor: q.cursor !== undefined ? String(q.cursor) : null,
  });
  return json(page);
});
