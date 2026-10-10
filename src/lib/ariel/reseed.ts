import { readFileSync } from "node:fs";
import path from "node:path";
import type { AppContext } from "@/lib/app-context";
import { auditLog } from "@/lib/db/schema";
import type { Session } from "@/types";
import { parseArielSeed, seedArielMock, type ArielSeed, type SeedResult } from "./seed";

export const DEFAULT_SEED_PATH = path.resolve(process.cwd(), "tests", "fixtures", "ariel-seed.json");

export function readSeedFile(file = DEFAULT_SEED_PATH): ArielSeed {
  return parseArielSeed(JSON.parse(readFileSync(file, "utf8")));
}

/** Truncate + reload the mock from the seed file; audit-logged when triggered by a user. */
export async function reseedArielMock(ctx: AppContext, session: Session | null, seed: ArielSeed = readSeedFile()): Promise<SeedResult> {
  const result = await ctx.db.transaction((tx) => seedArielMock(tx, seed, { pseudonymKey: ctx.config.sinPseudonymKey, encKey: ctx.config.sinEncKey }));
  if (session) {
    await ctx.db.insert(auditLog).values({ at: ctx.clock().toISOString(), actor: session.actor, role: session.role, action: "ARIEL_MOCK_RESEED", target: "ariel_mock", ip: null, details: result });
  }
  return result;
}