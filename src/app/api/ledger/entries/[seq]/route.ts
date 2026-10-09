import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { json, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { getLedgerEntry } from "@/lib/queries/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { app, session, params }) => {
  requireRole(session, "Reviewer", "Admin");
  const seq = z.coerce.number().int().positive().parse(params.seq);
  const entry = await getLedgerEntry(app, seq);
  if (!entry) throw notFound(`ledger entry ${seq}`);
  return json(entry);
});
