import { mkdir } from "node:fs/promises";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { AppConfig } from "@/lib/config";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic database handle: both PGlite and postgres.js drizzle instances satisfy this. */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  driver: "pglite" | "postgres";
  /** Applies pending migrations from the drizzle/ folder through the active driver. */
  migrate(migrationsFolder?: string): Promise<void>;
  close(): Promise<void>;
  /** Raw SQL escape hatch (tests, migrations, health checks). */
  exec(sqlText: string): Promise<void>;
}

export interface CreateDbOptions {
  /** "memory://" for an in-memory PGlite instance (tests). */
  dataDir?: string;
  url?: string;
}

const DEFAULT_MIGRATIONS = "drizzle";

export async function createPgliteHandle(dataDir: string): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir !== "memory://") await mkdir(dataDir, { recursive: true });
  const client = dataDir === "memory://" ? new PGlite() : new PGlite(dataDir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    driver: "pglite",
    migrate: (folder = DEFAULT_MIGRATIONS) => migrate(db, { migrationsFolder: folder }),
    close: () => client.close(),
    exec: (sqlText) => client.exec(sqlText).then(() => undefined),
  };
}

export async function createPostgresHandle(url: string): Promise<DbHandle> {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(url, { max: 10, prepare: false });
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    driver: "postgres",
    migrate: async (folder = DEFAULT_MIGRATIONS) => {
      const migrationClient = postgres(url, { max: 1 });
      try {
        await migrate(drizzle(migrationClient, { schema }), { migrationsFolder: folder });
      } finally {
        await migrationClient.end();
      }
    },
    close: () => client.end(),
    exec: async (sqlText) => {
      await client.unsafe(sqlText);
    },
  };
}

export function createDbHandle(config: Pick<AppConfig, "db">): Promise<DbHandle> {
  return config.db.driver === "postgres" ? createPostgresHandle(config.db.url) : createPgliteHandle(config.db.dataDir);
}

export { schema };
