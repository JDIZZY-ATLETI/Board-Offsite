import "dotenv/config";
import { loadConfig } from "../src/lib/config";
import { createDbHandle } from "../src/lib/db/client";

async function main() {
  const config = loadConfig();
  const handle = await createDbHandle(config);
  const target = config.db.driver === "postgres" ? config.db.url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@") : config.db.dataDir;
  console.log(`[db:migrate] driver=${config.db.driver} target=${target}`);
  await handle.migrate();
  console.log("[db:migrate] done");
  await handle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
