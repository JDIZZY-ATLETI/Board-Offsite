/**
 * Dev utility: validates every golden scenario in an in-memory context seeded from tests/fixtures/ariel-seed.json
 * and prints line -> message ids. `npx tsx scripts/golden-dump.ts [scenario]`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createAppContext } from "../src/lib/app-context";
import { readSeedFile } from "../src/lib/ariel/reseed";
import { seedArielMock } from "../src/lib/ariel/seed";
import { loadConfig } from "../src/lib/config";
import { createPgliteHandle } from "../src/lib/db/client";
import { batches, validationFindings, eventsRecords } from "../src/lib/db/schema";
import { ingestDateOf, lakePaths } from "../src/lib/lake/paths";
import { FsLakeStore } from "../src/lib/lake/fs-store";
import { createLogger } from "../src/lib/log";
import { ingest } from "../src/lib/pipeline/ingest";
import { runBatch } from "../src/lib/pipeline/run";
import { eq } from "drizzle-orm";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";

async function main() {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  const config = loadConfig({ ...process.env, DB_DRIVER: "pglite", PGLITE_DATA_DIR: "memory://", SIN_PSEUDONYM_KEY: "a1".repeat(32), SIN_ENC_KEY: "b2".repeat(32) });
  const handle = await createPgliteHandle("memory://");
  await handle.migrate(path.resolve(__dirname, "../drizzle"));
  await seedArielMock(handle.db, readSeedFile(), { pseudonymKey: config.sinPseudonymKey, encKey: config.sinEncKey });
  const ctx = await createAppContext({ config, dbHandle: handle, lake: new FsLakeStore(mkdtempSync(path.join(os.tmpdir(), "golden-"))), logger: createLogger({ level: "silent" }) });
  const root = path.resolve(__dirname, "../tests/golden");
  const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
  for (const scenario of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    if (only && scenario !== only) continue;
    const expected = path.join(root, scenario, "expected-message-ids.json");
    const exec = (existsSync(expected) ? JSON.parse(readFileSync(expected, "utf8")).executionDate : "2026-10-08") as `${number}-${number}-${number}`;
    const r = await ingest(ctx, { bytes: readFileSync(path.join(root, scenario, "input.csv")), filename: `${scenario}.csv`, employerId: "0235", submittedBy: "user:dump", executionDate: exec });
    if (r.duplicate) continue;
    const status = await runBatch(ctx, r.batchId);
    const findings = await ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, r.batchId));
    const records = await ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, r.batchId));
    console.log(`\n== ${scenario}: ${status} rows=${records.length} accepted=${records.filter((x) => x.outcome === "ACCEPTED").length} held=${records.filter((x) => x.outcome === "HELD").length} rejected=${records.filter((x) => x.outcome === "REJECTED").length}`);
    const byLine = new Map<number, string[]>();
    for (const f of findings) byLine.set(f.lineNumber ?? 0, [...(byLine.get(f.lineNumber ?? 0) ?? []), `${f.ruleId}/${f.messageId}${f.yearScope ? ":" + f.yearScope[0] : ""}`]);
    for (const [line, ids] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) console.log(`  ${String(line).padStart(3)}  ${records.find((x) => x.lineNumber === line)?.outcome ?? "-"}  ${ids.join("  ")}`);
    if (process.argv.includes("--write-expected") && status === "VALIDATED") {
      const [b] = await ctx.db.select().from(batches).where(eq(batches.batchId, r.batchId));
      const paths = lakePaths({ employerId: "0235", batchId: r.batchId, ingestDate: ingestDateOf(b.receivedAt) });
      const out = path.join(root, scenario, "expected-findings.ndjson");
      writeFileSync(out, await ctx.lake.get(paths.silver.findings));
      const counts = { rows: records.length, accepted: records.filter((x) => x.outcome === "ACCEPTED").length, held: records.filter((x) => x.outcome === "HELD").length, rejected: records.filter((x) => x.outcome === "REJECTED").length, findings: findings.length, executionDate: exec };
      writeFileSync(path.join(root, scenario, "expected-counts.json"), JSON.stringify(counts, null, 2) + "\n");
      console.log(`  wrote ${path.relative(process.cwd(), out)} + expected-counts.json ${JSON.stringify(counts)}`);
    }
  }
  await handle.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});