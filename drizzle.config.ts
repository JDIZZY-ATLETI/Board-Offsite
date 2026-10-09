import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  schemaFilter: ["public", "ariel_mock"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/hoopp_ledger" },
  strict: true,
  verbose: true,
});
