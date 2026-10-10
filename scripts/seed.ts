import "dotenv/config";
import { createAppContext } from "../src/lib/app-context";
import { readSeedFile, reseedArielMock } from "../src/lib/ariel/reseed";

/** Loads tests/fixtures/ariel-seed.json into ariel_mock (truncate + reload; architecture section 4.6). */
async function main() {
  const file = process.argv[2];
  const seed = readSeedFile(file);
  const ctx = await createAppContext();
  const result = await reseedArielMock(ctx, null, seed);
  console.log(`[db:seed] adapter=${ctx.ariel.name} members=${result.members} employments=${result.employments} employers=${result.employers} rateRows=${result.rateRows}`);
  await ctx.dbHandle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});