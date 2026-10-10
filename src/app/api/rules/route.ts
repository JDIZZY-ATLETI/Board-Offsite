import { json, withApi } from "@/lib/api/handler";
import { rulesCatalogue } from "@/lib/queries/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rule catalogue + effective config + hash (architecture section 11: role "any", no session required). */
export const GET = withApi(async (_req, { app }) => json(await rulesCatalogue(app)));
