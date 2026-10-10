import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalize } from "@/lib/crypto/canonical";
import { sha256Hex } from "@/lib/crypto/hash";
import type { IsoDate } from "@/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/) as unknown as z.ZodType<IsoDate>;

/** config/rules.events.json schema (architecture section 7.7). */
export const rulesConfigFileSchema = z.object({
  $comment: z.string().optional(),
  enabled: z.record(z.string(), z.boolean()).default({}),
  tolerances: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  nhh: z.record(z.string(), isoDate).default({}),
  nhhEmployers: z.array(z.string()).default([]),
});
export type RulesConfigFile = z.infer<typeof rulesConfigFileSchema>;

export interface RulesConfig {
  /** Architecture section 18 Q5. */
  i42ApplyToRetfin: boolean;
  /** Rule ids forced off by the RULES_DISABLED environment variable (architecture section 18 Q4). */
  disabled: ReadonlySet<string>;
  /** Per-rule enable flags; absent = the rule's `enabledByDefault`. */
  enabled: Readonly<Record<string, boolean>>;
  tolerances: Readonly<Record<string, number | string>>;
  nhh: Readonly<Record<string, IsoDate>>;
  nhhEmployers: readonly string[];
  /** sha256(JCS(effective config)) - stamped on batches and the execution report. */
  hash: string;
}

export interface RulesConfigOverride {
  ruleId: string;
  key: string;
  value: unknown;
}

export const DEFAULT_RULES_CONFIG_PATH = path.resolve(process.cwd(), "config", "rules.events.json");

export function readRulesConfigFile(file = DEFAULT_RULES_CONFIG_PATH): RulesConfigFile {
  const parsed = rulesConfigFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`invalid rules config ${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

export function hashRulesConfig(c: Omit<RulesConfig, "hash">): string {
  return sha256Hex(
    canonicalize({
      i42ApplyToRetfin: c.i42ApplyToRetfin,
      disabled: [...c.disabled].sort(),
      enabled: c.enabled,
      tolerances: c.tolerances,
      nhh: c.nhh,
      nhhEmployers: [...c.nhhEmployers],
    }),
  );
}

export interface BuildRulesConfigInput {
  file?: RulesConfigFile;
  overrides?: RulesConfigOverride[];
  i42ApplyToRetfin?: boolean;
  disabled?: Iterable<string>;
}

/** Layers Admin overrides on the file config and computes the hash. Pure. */
export function buildRulesConfig(input: BuildRulesConfigInput = {}): RulesConfig {
  const file = input.file ?? { enabled: {}, tolerances: {}, nhh: {}, nhhEmployers: [] };
  const enabled: Record<string, boolean> = { ...file.enabled };
  const tolerances: Record<string, number | string> = { ...file.tolerances };
  for (const o of input.overrides ?? []) {
    if (o.key === "enabled") {
      if (typeof o.value === "boolean") enabled[o.ruleId] = o.value;
    } else if (typeof o.value === "number" || typeof o.value === "string") {
      tolerances[o.key] = o.value;
    }
  }
  const base = {
    i42ApplyToRetfin: input.i42ApplyToRetfin ?? true,
    disabled: new Set(input.disabled ?? []),
    enabled,
    tolerances,
    nhh: { ...file.nhh },
    nhhEmployers: [...file.nhhEmployers],
  };
  return { ...base, hash: hashRulesConfig(base) };
}

/** Effective enable flag for a rule (architecture section 7.7). */
export function ruleEnabled(config: Pick<RulesConfig, "enabled" | "disabled">, ruleId: string, enabledByDefault: boolean): boolean {
  const flag = config.enabled[ruleId];
  return (flag ?? enabledByDefault) && !config.disabled.has(ruleId);
}

export function toleranceNumber(config: Pick<RulesConfig, "tolerances">, key: string, fallback: number): number {
  const v = config.tolerances[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function toleranceString(config: Pick<RulesConfig, "tolerances">, key: string, fallback: string): string {
  const v = config.tolerances[key];
  return typeof v === "string" ? v : fallback;
}

export interface ToleranceKeyDef {
  key: string;
  ruleId: string;
  unit: string;
  type: "number" | "string";
  /** Inclusive bounds for number keys (GAP-RULES-2); the sign of the default is part of the contract. */
  min?: number;
  max?: number;
  /** Human-readable note shown in the Admin UI. */
  note?: string;
}

/** Keys an Admin may override through PATCH /api/rules/{ruleId}, with units and ranges for the UI and the API. */
export const TOLERANCE_KEYS: ReadonlyArray<ToleranceKeyDef> = [
  { key: "B31.windowStart", ruleId: "B31", unit: "MM-DD", type: "string" },
  { key: "B37.tolerance1Weeks", ruleId: "B37", unit: "weeks", type: "number", min: 0, max: 52 },
  { key: "B37.tolerance2Dollars", ruleId: "B37", unit: "$ (Core Data only)", type: "number", min: 0, max: 100000, note: "Not used by the Events (Final Data) variant" },
  { key: "B38.toleranceWeeks", ruleId: "B38", unit: "weeks", type: "number", min: -52, max: 0, note: "Floor below the calculated amount; zero or negative" },
  { key: "B40.pct", ruleId: "B40", unit: "ratio", type: "number", min: 0, max: 10 },
  { key: "B41.pct", ruleId: "B41", unit: "ratio", type: "number", min: 0, max: 10 },
  { key: "B43.amount", ruleId: "B43", unit: "$", type: "number", min: -10000000, max: 0, note: "Decrease threshold; zero or negative" },
  { key: "B44.amount", ruleId: "B44", unit: "$", type: "number", min: -10000000, max: 0, note: "Decrease threshold; zero or negative" },
  { key: "B47.min", ruleId: "B47", unit: "$", type: "number", min: 0, max: 100000000, note: "Must stay below B47.max" },
  { key: "B47.max", ruleId: "B47", unit: "$", type: "number", min: 0, max: 100000000, note: "Must stay above B47.min" },
  { key: "B53a.pa", ruleId: "B53a", unit: "$", type: "number", min: 0, max: 100000 },
  { key: "B53b.pa", ruleId: "B53b", unit: "$", type: "number", min: 0, max: 100000 },
  { key: "B184a.weeks", ruleId: "B184a", unit: "weeks", type: "number", min: 0, max: 52 },
  { key: "B184b.weeks", ruleId: "B184b", unit: "weeks", type: "number", min: 0, max: 52 },
  { key: "B184c.weeks", ruleId: "B184c", unit: "weeks", type: "number", min: 0, max: 52 },
  { key: "B185.weeks", ruleId: "B185", unit: "weeks", type: "number", min: -52, max: 0, note: "Zero or negative" },
  { key: "B186a.weeks", ruleId: "B186a", unit: "weeks", type: "number", min: -52, max: 0, note: "Zero or negative" },
  { key: "B186b.weeks", ruleId: "B186b", unit: "weeks", type: "number", min: -52, max: 0, note: "Zero or negative" },
  { key: "B186c.factor", ruleId: "B186c", unit: "ratio", type: "number", min: 0, max: 1 },
  { key: "B214.weeks", ruleId: "B214", unit: "weeks", type: "number", min: 0, max: 52 },
  { key: "B214.minLeaveDays", ruleId: "B214", unit: "days", type: "number", min: 0, max: 366 },
];

export function toleranceKeysFor(ruleId: string): typeof TOLERANCE_KEYS {
  return TOLERANCE_KEYS.filter((t) => t.ruleId === ruleId);
}

/**
 * Validates one tolerance value against its definition; returns the problem or null. Cross-key rules (B47.min <
 * B47.max) are checked by `validateToleranceSet` against the effective values.
 */
export function toleranceProblem(def: ToleranceKeyDef, v: unknown): string | null {
  if (def.type === "string") return typeof v === "string" && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? null : `${def.key} must be MM-DD`;
  if (typeof v !== "number" || !Number.isFinite(v)) return `${def.key} must be a number`;
  if (def.min !== undefined && v < def.min) return `${def.key} must be >= ${def.min}`;
  if (def.max !== undefined && v > def.max) return `${def.key} must be <= ${def.max}`;
  return null;
}

/** Cross-key constraints over the effective tolerances after a patch is applied. */
export function validateToleranceSet(effective: Record<string, number | string>): string | null {
  const min = effective["B47.min"];
  const max = effective["B47.max"];
  if (typeof min === "number" && typeof max === "number" && !(min < max)) return `B47.min (${min}) must be less than B47.max (${max})`;
  return null;
}