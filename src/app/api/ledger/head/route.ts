import { json, withApi } from "@/lib/api/handler";
import { getLedgerHead } from "@/lib/queries/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { app }) => json(await getLedgerHead(app)));
