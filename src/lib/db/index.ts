import { getConfig } from "@/lib/config";
import { createDbHandle, type DbHandle } from "./client";

// Cached on globalThis so Next.js dev HMR does not open a new PGlite/pool per reload.
const g = globalThis as unknown as { __hooppDbHandle?: Promise<DbHandle> };

export function getDbHandle(): Promise<DbHandle> {
  if (!g.__hooppDbHandle) {
    g.__hooppDbHandle = createDbHandle(getConfig());
  }
  return g.__hooppDbHandle;
}

export async function getDb() {
  return (await getDbHandle()).db;
}

export function setDbHandleForTests(handle: DbHandle | null): void {
  g.__hooppDbHandle = handle ? Promise.resolve(handle) : undefined;
}

export * from "./client";
