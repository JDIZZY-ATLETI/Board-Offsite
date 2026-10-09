import { z } from "zod";

const hexKey = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)");

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

// Deterministic, clearly-dev keys used only when NODE_ENV !== production and no key is configured.
const DEV_PSEUDONYM_KEY = "00".repeat(16) + "11".repeat(16);
const DEV_ENC_KEY = "22".repeat(16) + "33".repeat(16);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DB_DRIVER: z.enum(["pglite", "postgres"]).default("pglite"),
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DATA_DIR: z.string().min(1).default(".data/pglite"),
  LAKE_ROOT: z.string().min(1).default(".data/lake"),
  SIN_PSEUDONYM_KEY: hexKey.optional(),
  SIN_ENC_KEY: hexKey.optional(),
  AUTH_MODE: z.enum(["header"]).default("header"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_PRETTY: boolish.default(false),
  ALLOW_SUBMITTER_OVERRIDE: boolish.default(false),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_UPLOAD_ROWS: z.coerce.number().int().positive().default(50_000),
  MAX_LINE_LENGTH: z.coerce.number().int().positive().default(4096),
  BATCH_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Architecture section 18 Q5: apply I42 future-date check to RETFIN as well. */
  I42_APPLY_TO_RETFIN: boolish.default(true),
  /** Comma-separated rule ids to disable (e.g. "I9"). Architecture section 18 Q4. */
  RULES_DISABLED: z.string().default(""),
  APP_VERSION: z.string().default("0.1.0"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  db: { driver: "pglite"; dataDir: string } | { driver: "postgres"; url: string };
  lakeRoot: string;
  sinPseudonymKey: Buffer;
  sinEncKey: Buffer;
  authMode: "header";
  logLevel: string;
  logPretty: boolean;
  allowSubmitterOverride: boolean;
  maxUploadBytes: number;
  maxUploadRows: number;
  maxLineLength: number;
  batchConcurrency: number;
  i42ApplyToRetfin: boolean;
  rulesDisabled: Set<string>;
  appVersion: string;
  /** True when a dev fallback key was used; logged loudly at startup. */
  usingDevKeys: boolean;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === "production";
  let usingDevKeys = false;
  let pseudo = e.SIN_PSEUDONYM_KEY;
  let enc = e.SIN_ENC_KEY;
  if (!pseudo || !enc) {
    if (isProd) throw new ConfigError("SIN_PSEUDONYM_KEY and SIN_ENC_KEY are required in production");
    usingDevKeys = true;
    pseudo = pseudo ?? DEV_PSEUDONYM_KEY;
    enc = enc ?? DEV_ENC_KEY;
  }
  if (pseudo === enc) throw new ConfigError("SIN_PSEUDONYM_KEY and SIN_ENC_KEY must differ");

  let db: AppConfig["db"];
  if (e.DB_DRIVER === "postgres") {
    if (!e.DATABASE_URL) throw new ConfigError("DATABASE_URL is required when DB_DRIVER=postgres");
    db = { driver: "postgres", url: e.DATABASE_URL };
  } else {
    db = { driver: "pglite", dataDir: e.PGLITE_DATA_DIR };
  }

  return {
    nodeEnv: e.NODE_ENV,
    db,
    lakeRoot: e.LAKE_ROOT,
    sinPseudonymKey: Buffer.from(pseudo, "hex"),
    sinEncKey: Buffer.from(enc, "hex"),
    authMode: e.AUTH_MODE,
    logLevel: e.LOG_LEVEL,
    logPretty: e.LOG_PRETTY,
    allowSubmitterOverride: e.ALLOW_SUBMITTER_OVERRIDE,
    maxUploadBytes: e.MAX_UPLOAD_BYTES,
    maxUploadRows: e.MAX_UPLOAD_ROWS,
    maxLineLength: e.MAX_LINE_LENGTH,
    batchConcurrency: e.BATCH_CONCURRENCY,
    i42ApplyToRetfin: e.I42_APPLY_TO_RETFIN,
    rulesDisabled: new Set(
      e.RULES_DISABLED.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    appVersion: e.APP_VERSION,
    usingDevKeys,
  };
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
