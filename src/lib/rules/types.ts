import type { EncodingProblem } from "@/lib/events/decode";
import type { AnyCsvColumn, EventsRecord, FindingParams, FindingSeverity, FindingVisibility, IsoDate, RawEventsRow, YearScope } from "@/types";

export type RuleLevel = "L0" | "L1" | "L2";
export type RuleSection = "EVENTS";
export type RuleTool = "DataImport" | "CustomDLL" | "StandardValidationModule";

export interface RulesConfig {
  /** Architecture section 18 Q5. */
  i42ApplyToRetfin: boolean;
  /** Rule ids disabled by configuration (architecture section 7.7 `enabled`). */
  disabled: ReadonlySet<string>;
}

export interface RuleContext {
  batch: { batchId: string; employerId: string; executionDate: IsoDate };
  file: { header: string[]; rows: RawEventsRow[]; records: EventsRecord[]; encodingProblem?: EncodingProblem | null };
  config: RulesConfig;
  /** Injected clock (deterministic tests). Defaults to the batch execution date. */
  now: () => IsoDate;
  /** Normalised SIN -> number of data rows carrying it (I10). */
  sinCounts: ReadonlyMap<string, number>;
}

export interface FindingDraft {
  field?: AnyCsvColumn;
  yearScope?: YearScope;
  params: FindingParams;
  calculated?: Record<string, string | number | boolean>;
  messageIdOverride?: string;
}

export interface Rule {
  id: string;
  label: string;
  messageId: string | ((d: FindingDraft) => string);
  level: RuleLevel;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  section: RuleSection[];
  tool: RuleTool;
  overrideReasons: string[];
  /** Template with {n} placeholders, verbatim from the spec. */
  dataImportMessage: string;
  portalMessage: string;
  enabledByDefault: boolean;
  /** L2 rules that need the Ariel snapshot are not runnable in Phase 1. */
  requiresAriel: boolean;
  /** L0: called once with record = null. L1/L2: per record. */
  appliesTo(record: EventsRecord | null, ctx: RuleContext): boolean;
  evaluate(record: EventsRecord | null, ctx: RuleContext): FindingDraft[];
}

export type RuleSpec = Omit<Rule, "section" | "tool" | "overrideReasons" | "enabledByDefault" | "requiresAriel" | "appliesTo"> &
  Partial<Pick<Rule, "section" | "tool" | "overrideReasons" | "enabledByDefault" | "requiresAriel" | "appliesTo">>;

export function defineRule(spec: RuleSpec): Rule {
  return {
    section: ["EVENTS"],
    tool: "DataImport",
    overrideReasons: [],
    enabledByDefault: true,
    requiresAriel: false,
    appliesTo: () => true,
    ...spec,
  };
}
