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

/** Keys an Admin may override through PATCH /api/rules/{ruleId}, with units for the UI. */
export const TOLERANCE_KEYS: ReadonlyArray<{ key: string; ruleId: string; unit: string; type: "number" | "string" }> = [
  { key: "B31.windowStart", ruleId: "B31", unit: "MM-DD", type: "string" },
  { key: "B37.tolerance1Weeks", ruleId: "B37", unit: "weeks", type: "number" },
  { key: "B37.tolerance2Dollars", ruleId: "B37", unit: "$ (Core Data only)", type: "number" },
  { key: "B38.toleranceWeeks", ruleId: "B38", unit: "weeks", type: "number" },
  { key: "B40.pct", ruleId: "B40", unit: "ratio", type: "number" },
  { key: "B41.pct", ruleId: "B41", unit: "ratio", type: "number" },
  { key: "B43.amount", ruleId: "B43", unit: "$", type: "number" },
  { key: "B44.amount", ruleId: "B44", unit: "$", type: "number" },
  { key: "B47.min", ruleId: "B47", unit: "$", type: "number" },
  { key: "B47.max", ruleId: "B47", unit: "$", type: "number" },
  { key: "B53a.pa", ruleId: "B53a", unit: "$", type: "number" },
  { key: "B53b.pa", ruleId: "B53b", unit: "$", type: "number" },
  { key: "B184a.weeks", ruleId: "B184a", unit: "weeks", type: "number" },
  { key: "B184b.weeks", ruleId: "B184b", unit: "weeks", type: "number" },
  { key: "B184c.weeks", ruleId: "B184c", unit: "weeks", type: "number" },
  { key: "B185.weeks", ruleId: "B185", unit: "weeks", type: "number" },
  { key: "B186a.weeks", ruleId: "B186a", unit: "weeks", type: "number" },
  { key: "B186b.weeks", ruleId: "B186b", unit: "weeks", type: "number" },
  { key: "B186c.factor", ruleId: "B186c", unit: "ratio", type: "number" },
  { key: "B214.weeks", ruleId: "B214", unit: "weeks", type: "number" },
  { key: "B214.minLeaveDays", ruleId: "B214", unit: "days", type: "number" },
];

export function toleranceKeysFor(ruleId: string): typeof TOLERANCE_KEYS {
  return TOLERANCE_KEYS.filter((t) => t.ruleId === ruleId);
}