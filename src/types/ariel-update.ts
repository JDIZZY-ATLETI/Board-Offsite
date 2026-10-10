import type { AnyCsvColumn, EventType, IsoDate, YearScope } from "./events";

/**
 * Architecture section 4.4 / 8. `Member` (D-MBR-DOD) and `CalculationIndicator` (D-CALC-INDICATOR, section 8.6)
 * are listed in section 8 but missing from the section 4.4 union; they are added here (section 18 Q28).
 */
export const ARIEL_RECORD_TYPES = [
  "Employment",
  "Member",
  "TransactionsServiceBreak",
  "TransactionsService",
  "TransactionsContributions",
  "TransactionsSalaryRates",
  "PlansTaxInfoPA",
  "MembershipStatus",
  "CalculationsBenefit",
  "CalculationIndicator",
  "BenefitReevaluationFlag",
] as const;
export type ArielRecordType = (typeof ARIEL_RECORD_TYPES)[number];

export const ARIEL_OPERATIONS = ["UPDATE", "CREATE", "UPSERT_ADD", "CLOSE", "DELETE", "SET_FLAG"] as const;
export type ArielOperation = (typeof ARIEL_OPERATIONS)[number];

export type ArielFieldValue = string | number | boolean | null;
export type ArielFieldMap = Record<string, ArielFieldValue>;

/**
 * Pure derivation output: everything the Ariel loader and the reviewer need, nothing that depends on ids or
 * clocks. `contentHash` is computed over a sorted list of these (architecture section 4.4).
 */
export interface ArielUpdateItemCore {
  sinPseudo: string;
  sinMasked: string;
  /** "***-***-563 ABLE, Anna" (masked SIN + file names). */
  memberDisplay: string;
  employerId: string;
  lineNumber: number;
  eventType: EventType;
  eventDate: IsoDate;
  recordType: ArielRecordType;
  operation: ArielOperation;
  yearScope: YearScope | null;
  /** Natural key Ariel uses to match an existing record; always carries employmentId or memberId. */
  targetKey: ArielFieldMap;
  /** Resulting values. */
  fields: ArielFieldMap;
  /** Ariel snapshot values; null for CREATE / SET_FLAG. */
  before: ArielFieldMap | null;
  sourceFields: AnyCsvColumn[];
  /** e.g. "D-CONTRIB-RPPHGH-CLC-CY" */
  derivationRule: string;
  explanation: string;
  /** Formula inputs/outputs (CLC split, UPSERT_ADD sums, previous status) for FormulaExplanation. */
  calculated: ArielFieldMap | null;
  /** Section 8.13 order within the member. */
  sortOrder: number;
}

export interface ArielUpdateItem extends ArielUpdateItemCore {
  itemId: string;
  updateSetId: string;
  recordId: string | null;
  /** ArielUpdateProposed entry that carries this item's hash. */
  ledgerEntryId: string;
}

export const UPDATE_SET_STATUSES = ["BUILDING", "PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPORTED"] as const;
export type UpdateSetStatus = (typeof UPDATE_SET_STATUSES)[number];

export interface UpdateSetCounts {
  byRecordType: Partial<Record<ArielRecordType, number>>;
  byOperation: Partial<Record<ArielOperation, number>>;
  byEventType: Partial<Record<EventType, number>>;
}

export interface ArielUpdateSet {
  updateSetId: string;
  batchId: string;
  employerId: string;
  buildNo: number;
  status: UpdateSetStatus;
  itemCount: number;
  memberCount: number;
  contentHash: string;
  counts: UpdateSetCounts;
  artifacts: Record<string, string>;
  ledgerEntryId: string | null;
  ledgerSeq: number | null;
  builtAt: string;
  updatedAt: string;
}

export interface Approval {
  approvalId: string;
  updateSetId: string;
  decision: "APPROVED" | "REJECTED";
  actor: string;
  role: string;
  reason: string | null;
  contentHashAtDecision: string;
  decidedAt: string;
  ledgerEntryId: string;
}

export type ExportFormatId = "json" | "csv";
export type ExportFormatRequest = ExportFormatId | "both";

export interface ExportFile {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface ExportRecord {
  exportId: string;
  updateSetId: string;
  batchId: string;
  actor: string;
  format: ExportFormatRequest;
  contentHash: string;
  exportedAt: string;
  exportDir: string;
  files: ExportFile[];
  ledgerEntryId: string;
  ledgerSeq: number | null;
}

/** Gold artifact `ariel-update-set.json` (architecture section 5): deterministic, no ids/clocks. */
export interface UpdateSetGoldDocument {
  schemaVersion: 1;
  employerId: string;
  executionDate: IsoDate;
  contentHash: string;
  itemCount: number;
  memberCount: number;
  counts: UpdateSetCounts;
  members: Array<{
    sinPseudo: string;
    sinMasked: string;
    memberDisplay: string;
    lineNumber: number;
    eventType: EventType;
    eventDate: IsoDate;
    itemCount: number;
    items: ArielUpdateItemCore[];
  }>;
}

/** Note emitted by the final derivation that is persisted as an INFORMATION finding (section 8.5). */
export interface DerivationNote {
  rule: string;
  message: string;
  params: Record<string, string | number>;
}