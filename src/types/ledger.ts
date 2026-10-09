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
  | "ChainAnchorPublished";

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

export type LedgerPayload =
  | BatchReceivedPayload
  | BatchParsedPayload
  | BatchFileRejectedPayload
  | MemberRecordRejectedPayload;

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
