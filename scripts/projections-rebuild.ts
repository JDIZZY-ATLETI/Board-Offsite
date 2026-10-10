import "dotenv/config";
import { createAppContext } from "../src/lib/app-context";
import { rebuildProjections } from "../src/lib/projection";

/** `npm run projections:rebuild`: drop member_projections + checkpoint and replay the ledger from seq 1 (AC4). */
async function main() {
  const ctx = await createAppContext();
  const run = await rebuildProjections(ctx);
  console.log(JSON.stringify({ projection: "member_projections", ...run }, null, 2));
  await ctx.dbHandle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});