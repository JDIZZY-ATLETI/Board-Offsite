import "dotenv/config";
import { createAppContext } from "../src/lib/app-context";

async function main() {
  const ctx = await createAppContext();
  const result = await ctx.ledger.verify();
  console.log(JSON.stringify(result, null, 2));
  await ctx.dbHandle.close();
  process.exit(result.ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
