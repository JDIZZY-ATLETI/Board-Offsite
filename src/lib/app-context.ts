import { uuidv7 } from "uuidv7";
import { getConfig, type AppConfig } from "@/lib/config";
import { createDbHandle, type Db, type DbHandle } from "@/lib/db/client";
import { FsLakeStore, type LakeStore } from "@/lib/lake";
import { LedgerService } from "@/lib/ledger/service";
import { createLogger, getLogger, type Logger } from "@/lib/log";

export interface AppContext {
  config: AppConfig;
  dbHandle: DbHandle;
  db: Db;
  lake: LakeStore;
  ledger: LedgerService;
  logger: Logger;
  clock: () => Date;
  newId: () => string;
}

export interface AppContextOverrides {
  config?: AppConfig;
  dbHandle?: DbHandle;
  lake?: LakeStore;
  logger?: Logger;
  clock?: () => Date;
  newId?: () => string;
}

export async function createAppContext(overrides: AppContextOverrides = {}): Promise<AppContext> {
  const config = overrides.config ?? getConfig();
  const logger = overrides.logger ?? (overrides.config ? createLogger({ level: config.logLevel, pretty: config.logPretty }) : getLogger());
  if (config.usingDevKeys) {
    logger.warn("SIN_PSEUDONYM_KEY / SIN_ENC_KEY not set: using built-in DEVELOPMENT keys. Never do this outside local dev.");
  }
  const dbHandle = overrides.dbHandle ?? (await createDbHandle(config));
  const clock = overrides.clock ?? (() => new Date());
  const newId = overrides.newId ?? uuidv7;
  return {
    config,
    dbHandle,
    db: dbHandle.db,
    lake: overrides.lake ?? new FsLakeStore(config.lakeRoot),
    ledger: new LedgerService(dbHandle.db, { clock, newId }),
    logger,
    clock,
    newId,
  };
}

const g = globalThis as unknown as { __hooppAppContext?: Promise<AppContext> };

export function getAppContext(): Promise<AppContext> {
  if (!g.__hooppAppContext) g.__hooppAppContext = createAppContext();
  return g.__hooppAppContext;
}

export function setAppContextForTests(ctx: AppContext | null): void {
  g.__hooppAppContext = ctx ? Promise.resolve(ctx) : undefined;
}
