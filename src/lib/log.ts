import { existsSync } from "node:fs";
import path from "node:path";
import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

/** Any field named sin/SIN at any depth is redacted; never log raw SIN. */
export const REDACT_PATHS = [
  "sin",
  "SIN",
  "*.sin",
  "*.SIN",
  "*.*.sin",
  "*.*.SIN",
  "values.SIN",
  "*.values.SIN",
  "rawValues.SIN",
  "*.rawValues.SIN",
  "req.headers.authorization",
  "req.headers.cookie",
];

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  stream?: DestinationStream;
  base?: Record<string, unknown>;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    base: opts.base ?? {},
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: "msg",
  };
  if (opts.stream) return pino(options, opts.stream);
  if (opts.pretty) {
    // pino-pretty is a dev dependency loaded in a worker thread. The worker resolves the target as an ES module,
    // so it must be the entry *file* (a directory import throws ERR_UNSUPPORTED_DIR_IMPORT - Phase 2 QA GAP-ENV-1);
    // inside the Next.js server bundle the bare name does not resolve either, hence the absolute path.
    const target = path.join(process.cwd(), "node_modules", "pino-pretty", "index.js");
    if (!existsSync(target)) return pino(options);
    try {
      return pino({ ...options, transport: { target, options: { colorize: true } } });
    } catch {
      return pino(options);
    }
  }
  return pino(options);
}

let root: Logger | null = null;

export function getLogger(): Logger {
  if (!root) {
    const level = process.env.LOG_LEVEL ?? "info";
    const pretty = process.env.LOG_PRETTY === "true" || process.env.LOG_PRETTY === "1";
    root = createLogger({ level, pretty });
  }
  return root;
}

export function setRootLoggerForTests(logger: Logger | null): void {
  root = logger;
}

export type { Logger };
