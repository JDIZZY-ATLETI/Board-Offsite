import type { FindingParams } from "./batch";
import type { EventsCsvColumn, EventType, IsoDate, YearScope } from "./events";

export type LedgerEventType =
  | "BatchReceived"
  | "BatchParsed"
  | "BatchFileRejected"
  | "MemberRecordValidated"
  | "MemberRecordRejected"
  | "WarningOverridden"
  | "ArielUpdateProposed"
  | "UpdateSetBuilt"
  | "UpdateSetApproved"
  | "UpdateSetRejected"
  | "UpdateSetExported"
  | "CorrectionAppended"
  | "ChainAnchorPublished"
  | "RulesConfigChanged"
  | "BatchReopened";

export const LEDGER_EVENT_TYPES: readonly LedgerEventType[] = [
  "BatchReceived",
  "BatchParsed",
  "BatchFileRejected",
  "MemberRecordValidated",
  "MemberRecordRejected",
  "WarningOverridden",
  "ArielUpdateProposed",
  "UpdateSetBuilt",
  "UpdateSetApproved",
  "UpdateSetRejected",
  "UpdateSetExported",
  "CorrectionAppended",
  "ChainAnchorPublished",
  "RulesConfigChanged",
  "BatchReopened",
];

export interface LedgerEntry {
  seq: number;
  entryId: string;
  streamId: string;
  streamSeq: number;
  eventType: LedgerEventType;
  batchId: string | null;
  actor: string;
  /** RFC 3339 UTC with millisecond precision and Z suffix. */
  occurredAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  prevHashGlobal: string;
  prevHashStream: string;
  entryHash: string;
}

export interface FindingSummary {
  ruleId: string;
  messageId: string;
  field: EventsCsvColumn | "DateOfDeath" | null;
  yearScope: YearScope | null;
  params: FindingParams;
}

export interface BatchReceivedPayload {
  employerId: string;
  originalFilename: string;
  sha256: string;
  sizeBytes: number;
  executionDate: IsoDate;
  uploadedBy: string;
  /** Present when the same bytes were re-uploaded: no new batch was created. */
  duplicateOf?: string;
}

export interface BatchParsedPayload {
  sha256: string;
  encoding: string;
  header: string[];
  rows: number;
  parseOk: number;
}

export interface BatchFileRejectedPayload {
  sha256: string;
  findings: FindingSummary[];
}

export interface MemberRecordRejectedPayload {
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  findings: FindingSummary[];
}

/** Architecture section 9 / 17 Phase 2: accepted row (possibly after overrides). */
export interface MemberRecordValidatedPayload {
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  /** WARNING / INFORMATION findings on the accepted row, sorted. */
  findings: FindingSummary[];
  overrides: Array<{ findingId: string; ruleId: string; reason: string }>;
  /** sha256(JCS(findings)) - lets a verifier compare the row's findings without re-running the engine. */
  findingsHash: string;
  rulesConfigHash: string;
  arielSnapshotHash: string;
}

export interface WarningOverriddenPayload {
  findingId: string;
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  ruleId: string;
  messageId: string;
  yearScope: YearScope | null;
  reason: string;
  note?: string;
  /** Row outcome once this override is applied. */
  rowOutcome: "ACCEPTED" | "HELD" | "REJECTED";
}

export interface RulesConfigChangedPayload {
  previousHash: string;
  newHash: string;
  changes: Array<{ ruleId: string; key: string; from: unknown; to: unknown }>;
  reason: string;
}

/** Section 9 / Phase 3: one per accepted row. Items themselves live in ariel_update_items + gold; the payload carries their hash. */
export interface ArielUpdateProposedPayload {
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  employerId: string;
  itemCount: number;
  /** sha256(JCS(items sorted by sortOrder)) over the pure item cores. */
  itemsHash: string;
  byRecordType: Record<string, number>;
  byOperation: Record<string, number>;
  derivationRules: string[];
  /** D-NCT result when emitted (business data, no PII). */
  membershipStatus: { status: string; subStatus: string | null; effectiveDate: IsoDate } | null;
  membershipStatusBefore: { status: string | null; subStatus: string | null } | null;
  employmentTermination: { terminationDate: IsoDate; terminationCode: string | null } | null;
  arielSnapshotHash: string;
}

export interface UpdateSetBuiltPayload {
  updateSetId: string;
  buildNo: number;
  contentHash: string;
  itemCount: number;
  memberCount: number;
  byRecordType: Record<string, number>;
  byOperation: Record<string, number>;
  artifacts: Record<string, string>;
  /** sha256 of each gold artifact so the chain attests the files. */
  artifactHashes: Record<string, string>;
  arielSnapshotHash: string;
  rulesConfigHash: string;
}

export interface UpdateSetApprovedPayload {
  updateSetId: string;
  approvalId: string;
  contentHash: string;
  itemCount: number;
  memberCount: number;
  note: string;
  role: string;
}

export interface UpdateSetRejectedPayload {
  updateSetId: string;
  approvalId: string;
  contentHash: string;
  reason: string;
  role: string;
}

export interface UpdateSetExportedPayload {
  exportId: string;
  updateSetId: string;
  contentHash: string;
  format: "json" | "csv" | "both";
  files: Array<{ name: string; sha256: string; bytes: number }>;
  itemCount: number;
  memberCount: number;
}

export interface BatchReopenedPayload {
  updateSetId: string | null;
  reason: string;
  heldRows: number;
}

/** Section 9.6: a later batch resubmits a member event that an earlier, unexported entry already covered. */
export interface CorrectionAppendedPayload {
  recordId: string;
  lineNumber: number;
  sinMasked: string | null;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  kind: "RESUBMITTED_PROPOSAL" | "CORRECTED_REJECTION";
  supersedesEntryId: string;
  supersedesSeq: number;
  supersedesBatchId: string | null;
  supersedesEventType: LedgerEventType;
  newEntryId: string;
}

export type LedgerPayload =
  | BatchReceivedPayload
  | BatchParsedPayload
  | BatchFileRejectedPayload
  | MemberRecordRejectedPayload
  | MemberRecordValidatedPayload
  | WarningOverriddenPayload
  | RulesConfigChangedPayload
  | ArielUpdateProposedPayload
  | UpdateSetBuiltPayload
  | UpdateSetApprovedPayload
  | UpdateSetRejectedPayload
  | UpdateSetExportedPayload
  | BatchReopenedPayload
  | CorrectionAppendedPayload;

export interface LedgerHead {
  seq: number;
  hash: string;
  streams: number;
}

export interface VerificationResult {
  ok: boolean;
  checked: number;
  firstBadSeq?: number;
  reason?: string;
  headSeq: number;
  headHash: string;
  durationMs: number;
}
