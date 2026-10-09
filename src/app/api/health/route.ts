import { sql } from "drizzle-orm";
import { json, withApi } from "@/lib/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (_req, { app }) => {
  const checks: Record<string, string> = { db: "ok", lake: "ok" };
  let ledgerHead: { seq: number; hash: string } | null = null;
  try {
    await app.db.execute(sql`select 1`);
    const head = await app.ledger.head();
    ledgerHead = { seq: head.seq, hash: head.hash };
  } catch (err) {
    checks.db = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    await app.lake.list("anchors");
  } catch (err) {
    checks.lake = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ok = checks.db === "ok" && checks.lake === "ok";
  return json(
    { status: ok ? "ok" : "degraded", ...checks, dbDriver: app.dbHandle.driver, ledgerHead, version: app.config.appVersion },
    { status: ok ? 200 : 503 },
  );
});
