import type { ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import type { FileDerived } from "@/lib/derivation/provisional";
import type { EncodingProblem } from "@/lib/events/decode";
import type { AnyCsvColumn, ArielRateTables, EventsRecord, FindingParams, FindingSeverity, FindingVisibility, IsoDate, RawEventsRow, YearScope } from "@/types";
import type { RulesConfig } from "./config";

export type { RulesConfig } from "./config";

export type RuleLevel = "L0" | "L1" | "L2";
export type RuleSection = "EVENTS";
export type RuleTool = "DataImport" | "CustomDLL" | "StandardValidationModule";

export interface RuleContext {
  batch: { batchId: string; employerId: string; executionDate: IsoDate };
  file: { header: string[]; rows: RawEventsRow[]; records: EventsRecord[]; encodingProblem?: EncodingProblem | null };
  config: RulesConfig;
  /** Injected clock (deterministic tests). Defaults to the batch execution date. */
  now: () => IsoDate;
  /** Normalised SIN pseudonym -> number of data rows carrying it (I10). */
  sinCounts: ReadonlyMap<string, number>;
  /** Ariel snapshot taken at validate start (architecture section 7.1). */
  ariel: ArielBatchSnapshot;
  rates: ArielRateTables;
  /** Provisional derivation (architecture section 8.1) for L2 rules; null when no employment matches. */
  derived: (record: EventsRecord) => FileDerived | null;
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
  /** L2 rules that read the Ariel snapshot. Skipped for a record once B2 fires (no employment to read). */
  requiresAriel: boolean;
  /** Spec note / architecture section 18 reference shown in the registry UI. */
  specNote?: string;
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