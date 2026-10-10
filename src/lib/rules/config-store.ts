import { eq, and } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import type { DbOrTx } from "@/lib/db/client";
import { auditLog, rulesConfigOverrides } from "@/lib/db/schema";
import { SYSTEM_STREAM } from "@/lib/ledger/streams";
import type { RulesConfigChangedPayload, Session } from "@/types";
import { buildRulesConfig, readRulesConfigFile, TOLERANCE_KEYS, type RulesConfig, type RulesConfigFile, type RulesConfigOverride } from "./config";
import { ruleById } from "./registry";

let fileCache: RulesConfigFile | null = null;

export function fileRulesConfig(): RulesConfigFile {
  if (!fileCache) fileCache = readRulesConfigFile();
  return fileCache;
}

export function resetRulesConfigCacheForTests(): void {
  fileCache = null;
}

export async function listOverrides(db: DbOrTx): Promise<RulesConfigOverride[]> {
  const rows = await db.select().from(rulesConfigOverrides);
  return rows.map((r) => ({ ruleId: r.ruleId, key: r.key, value: r.value })).sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.key.localeCompare(b.key));
}

/** Effective config = file + DB overrides + env (architecture section 7.7). */
export async function loadEffectiveRulesConfig(ctx: AppContext, db: DbOrTx = ctx.db): Promise<RulesConfig> {
  const overrides = await listOverrides(db);
  return buildRulesConfig({ file: fileRulesConfig(), overrides, i42ApplyToRetfin: ctx.config.i42ApplyToRetfin, disabled: ctx.config.rulesDisabled });
}

export interface RulesPatch {
  enabled?: boolean;
  tolerances?: Record<string, number | string>;
  reason: string;
}

export class RulesConfigError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Applies an Admin change, ledgers it on the `system` stream and audit-logs it. Returns the new effective config. */
export async function patchRuleConfig(ctx: AppContext, session: Session, ruleId: string, patch: RulesPatch): Promise<{ config: RulesConfig; changes: RulesConfigChangedPayload["changes"]; ledgerSeq: number | null }> {
  const rule = ruleById(ruleId);
  if (!rule) throw new RulesConfigError(404, "NOT_FOUND", `rule ${ruleId} not found`);
  const allowedKeys = new Set(TOLERANCE_KEYS.filter((t) => t.ruleId === ruleId).map((t) => t.key));
  for (const k of Object.keys(patch.tolerances ?? {})) {
    if (!allowedKeys.has(k)) throw new RulesConfigError(422, "UNKNOWN_TOLERANCE", `${k} is not a tolerance of ${ruleId}`);
    const def = TOLERANCE_KEYS.find((t) => t.key === k)!;
    const v = patch.tolerances![k];
    if (def.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) throw new RulesConfigError(422, "INVALID_TOLERANCE", `${k} must be a number`);
    if (def.type === "string" && (typeof v !== "string" || !/^\d{2}-\d{2}$/.test(v))) throw new RulesConfigError(422, "INVALID_TOLERANCE", `${k} must be MM-DD`);
  }
  return ctx.db.transaction(async (tx) => {
    const before = await loadEffectiveRulesConfig(ctx, tx);
    const changes: RulesConfigChangedPayload["changes"] = [];
    const at = ctx.clock().toISOString();
    const upsert = async (key: string, value: unknown, from: unknown) => {
      changes.push({ ruleId, key, from, to: value });
      await tx
        .insert(rulesConfigOverrides)
        .values({ ruleId, key, value, updatedBy: session.actor, updatedAt: at })
        .onConflictDoUpdate({ target: [rulesConfigOverrides.ruleId, rulesConfigOverrides.key], set: { value, updatedBy: session.actor, updatedAt: at } });
    };
    if (patch.enabled !== undefined) {
      const current = before.enabled[ruleId] ?? rule.enabledByDefault;
      if (current !== patch.enabled) await upsert("enabled", patch.enabled, current);
    }
    for (const [k, v] of Object.entries(patch.tolerances ?? {})) {
      const current = before.tolerances[k];
      if (current !== v) await upsert(k, v, current ?? null);
    }
    if (changes.length === 0) return { config: before, changes, ledgerSeq: null };
    const after = await loadEffectiveRulesConfig(ctx, tx);
    const payload: RulesConfigChangedPayload = { previousHash: before.hash, newHash: after.hash, changes, reason: patch.reason };
    const entry = await ctx.ledger.append({ streamId: SYSTEM_STREAM, eventType: "RulesConfigChanged", batchId: null, actor: session.actor, payload: payload as unknown as Record<string, unknown> }, tx);
    await tx.insert(auditLog).values({ at, actor: session.actor, role: session.role, action: "RULES_CONFIG_CHANGED", target: `rule:${ruleId}`, ip: null, details: { changes, newHash: after.hash, ledgerSeq: entry.seq } });
    return { config: after, changes, ledgerSeq: entry.seq };
  });
}

/** Removes every Admin override for a rule (returns to file defaults). */
export async function resetRuleConfig(ctx: AppContext, session: Session, ruleId: string, reason: string): Promise<{ config: RulesConfig; ledgerSeq: number | null }> {
  return ctx.db.transaction(async (tx) => {
    const before = await loadEffectiveRulesConfig(ctx, tx);
    const rows = await tx.select().from(rulesConfigOverrides).where(eq(rulesConfigOverrides.ruleId, ruleId));
    if (rows.length === 0) return { config: before, ledgerSeq: null };
    for (const r of rows) await tx.delete(rulesConfigOverrides).where(and(eq(rulesConfigOverrides.ruleId, ruleId), eq(rulesConfigOverrides.key, r.key)));
    const after = await loadEffectiveRulesConfig(ctx, tx);
    const payload: RulesConfigChangedPayload = { previousHash: before.hash, newHash: after.hash, changes: rows.map((r) => ({ ruleId, key: r.key, from: r.value, to: null })), reason };
    const entry = await ctx.ledger.append({ streamId: SYSTEM_STREAM, eventType: "RulesConfigChanged", batchId: null, actor: session.actor, payload: payload as unknown as Record<string, unknown> }, tx);
    return { config: after, ledgerSeq: entry.seq };
  });
}