import type { AppContext } from "@/lib/app-context";
import { ruleEnabled, toleranceKeysFor, type RulesConfig } from "@/lib/rules/config";
import { loadEffectiveRulesConfig } from "@/lib/rules/config-store";
import { EVENTS_RULES } from "@/lib/rules/registry";
import type { FindingSeverity, FindingVisibility } from "@/types";

export interface RuleCatalogueItem {
  id: string;
  label: string;
  messageId: string;
  messageIds: string[];
  level: string;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  section: string[];
  tool: string;
  overrideReasons: string[];
  enabledByDefault: boolean;
  enabled: boolean;
  /** True when the effective flag differs from the file/default. */
  overridden: boolean;
  requiresAriel: boolean;
  dataImportMessage: string;
  portalMessage: string;
  specNote: string | null;
  /** Every rule in the registry has an evaluator (Phase 1 field restored for the UI, COS-P2-1). */
  implemented: boolean;
  tolerances: Array<{ key: string; value: number | string | null; unit: string; type: "number" | "string"; min?: number; max?: number; note?: string }>;
}

const MULTI_IDS: Record<string, string[]> = { I7: ["6503", "6642"], B112: ["1616", "8112"], B53b: ["7375", "8795"] };

export function catalogueFor(config: RulesConfig): RuleCatalogueItem[] {
  return EVENTS_RULES.map((r) => ({
    id: r.id,
    label: r.label,
    messageId: typeof r.messageId === "function" ? (MULTI_IDS[r.id] ?? ["multiple"]).join(" / ") : r.messageId,
    messageIds: typeof r.messageId === "function" ? (MULTI_IDS[r.id] ?? []) : [r.messageId],
    level: r.level,
    severity: r.severity,
    visibility: r.visibility,
    section: r.section,
    tool: r.tool,
    overrideReasons: r.overrideReasons,
    enabledByDefault: r.enabledByDefault,
    enabled: ruleEnabled(config, r.id, r.enabledByDefault),
    overridden: config.enabled[r.id] !== undefined && config.enabled[r.id] !== r.enabledByDefault,
    requiresAriel: r.requiresAriel,
    dataImportMessage: r.dataImportMessage,
    portalMessage: r.portalMessage,
    specNote: r.specNote ?? null,
    implemented: true,
    tolerances: toleranceKeysFor(r.id).map((t) => ({ key: t.key, value: config.tolerances[t.key] ?? null, unit: t.unit, type: t.type, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), ...(t.note ? { note: t.note } : {}) })),
  }));
}

export async function rulesCatalogue(ctx: AppContext): Promise<{ items: RuleCatalogueItem[]; config: { hash: string; enabled: Record<string, boolean>; tolerances: Record<string, number | string>; nhh: Record<string, string>; nhhEmployers: string[]; disabled: string[] } }> {
  const config = await loadEffectiveRulesConfig(ctx);
  return {
    items: catalogueFor(config),
    config: { hash: config.hash, enabled: { ...config.enabled }, tolerances: { ...config.tolerances }, nhh: { ...config.nhh }, nhhEmployers: [...config.nhhEmployers], disabled: [...config.disabled].sort() },
  };
}