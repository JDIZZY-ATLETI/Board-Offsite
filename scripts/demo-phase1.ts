/**
 * Phase 1 acceptance walk-through against the configured DB/lake (PGlite by default):
 *   happy-terfin -> VALIDATED; file-rejected-header -> FILE_REJECTED (I51); duplicate -> duplicate:true; verify -> ok.
 * Run: npm run db:migrate; npm run demo:phase1
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createAppContext } from "../src/lib/app-context";
import { validationFindings } from "../src/lib/db/schema";
import { ingest } from "../src/lib/pipeline/ingest";
import { runBatch } from "../src/lib/pipeline/run";

const golden = (s: string) => readFileSync(path.resolve(__dirname, "../tests/golden", s, "input.csv"));

async function main() {
  const ctx = await createAppContext();
  await ctx.dbHandle.migrate();
  const actor = "user:demo-admin";
  // Salt the files with a comment-free trailing CRLF so re-running the demo on a persistent DB still shows the duplicate path.
  const stamp = Buffer.from(`\r\n`);
  const terfin = Buffer.concat([golden("happy-terfin"), stamp]);
  const header = Buffer.concat([golden("file-rejected-header"), stamp]);

  const a = await ingest(ctx, { bytes: terfin, filename: "happy-terfin.csv", employerId: "0235", submittedBy: actor, executionDate: "2026-10-08" });
  const aStatus = a.duplicate ? "(duplicate of earlier demo run)" : await runBatch(ctx, a.batchId);
  console.log(`happy-terfin           -> batch ${a.batchId} ${aStatus}`);

  const b = await ingest(ctx, { bytes: header, filename: "file-rejected-header.csv", employerId: "0235", submittedBy: actor, executionDate: "2026-10-08" });
  const bStatus = b.duplicate ? "(duplicate)" : await runBatch(ctx, b.batchId);
  const findings = await ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, b.batchId));
  console.log(`file-rejected-header   -> batch ${b.batchId} ${bStatus} findings=${findings.map((f) => `${f.ruleId}/${f.messageId}`).join(",")}`);

  const c = await ingest(ctx, { bytes: terfin, filename: "happy-terfin-again.csv", employerId: "0235", submittedBy: actor, executionDate: "2026-10-08" });
  console.log(`re-upload happy-terfin -> duplicate=${c.duplicate} batchId=${c.batchId}`);

  const v = await ctx.ledger.verify();
  console.log(`ledger verify          -> ok=${v.ok} checked=${v.checked} headSeq=${v.headSeq} headHash=${v.headHash.slice(0, 16)}...`);
  console.log(`lake root              -> ${ctx.config.lakeRoot}`);
  await ctx.dbHandle.close();
  if (!v.ok || aStatus !== "VALIDATED" && !a.duplicate || bStatus !== "FILE_REJECTED" && !b.duplicate || !c.duplicate) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
