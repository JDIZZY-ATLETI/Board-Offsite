import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { createAppContext, setAppContextForTests, type AppContext } from "@/lib/app-context";
import { loadConfig, resetConfigForTests } from "@/lib/config";
import { createPgliteHandle, type DbHandle } from "@/lib/db/client";
import { FsLakeStore } from "@/lib/lake/fs-store";
import { createLogger } from "@/lib/log";
import { readSeedFile } from "@/lib/ariel/reseed";
import { seedArielMock, type ArielSeed } from "@/lib/ariel/seed";

export interface TestContext {
  ctx: AppContext;
  handle: DbHandle;
  lakeRoot: string;
  /** Every log line emitted during the test, as JSON strings. */
  logs: string[];
  cleanup(): Promise<void>;
}

export interface TestContextOptions {
  clock?: () => Date;
  newId?: () => string;
  env?: Record<string, string>;
  /** Load tests/fixtures/ariel-seed.json into ariel_mock (default true). */
  seedAriel?: boolean;
  seed?: ArielSeed;
}

let cachedSeed: ArielSeed | null = null;
export function fixtureSeed(): ArielSeed {
  if (!cachedSeed) cachedSeed = readSeedFile();
  return cachedSeed;
}

/** In-memory PGlite + temp lake dir + capturing logger, migrations applied. */
export async function createTestContext(opts: TestContextOptions = {}): Promise<TestContext> {
  resetConfigForTests();
  const config = loadConfig({ ...process.env, ...opts.env });
  const handle = await createPgliteHandle("memory://");
  await handle.migrate(path.resolve(__dirname, "../../drizzle"));
  if (opts.seedAriel !== false) await seedArielMock(handle.db, opts.seed ?? fixtureSeed(), { pseudonymKey: config.sinPseudonymKey, encKey: config.sinEncKey });
  const lakeRoot = await mkdtemp(path.join(os.tmpdir(), "hoopp-lake-"));
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger({ level: "trace", stream });
  const ctx = await createAppContext({ config, dbHandle: handle, lake: new FsLakeStore(lakeRoot), logger, clock: opts.clock, newId: opts.newId });
  setAppContextForTests(ctx);
  return {
    ctx,
    handle,
    lakeRoot,
    logs,
    async cleanup() {
      setAppContextForTests(null);
      await handle.close();
      await rm(lakeRoot, { recursive: true, force: true });
    },
  };
}

/** Deterministic id generator: 00000000-0000-7000-8000-000000000001, ... */
export function sequentialIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  };
}

/** Deterministic clock advancing 1 ms per call. */
export function tickingClock(start = Date.UTC(2026, 9, 8, 12, 0, 0)): () => Date {
  let t = start;
  return () => new Date(t++);
}
