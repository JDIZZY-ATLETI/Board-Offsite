import type { EventsCsvColumn, IsoDate, YearScope } from "./events";

export const BATCH_STATUSES = [
  "RECEIVED",
  "PARSED",
  "VALIDATED",
  "LEDGERED",
  "PROJECTION_BUILT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPORTED",
  "FAILED",
  "FILE_REJECTED",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const SOURCE_SYSTEMS = ["HOOPP_CSV", "WORKDAY", "CERIDIAN", "MEDITECH"] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export interface BatchCounts {
  rows: number;
  accepted: number;
  rejected: number;
  warnings: number;
  infos: number;
}

export interface Batch {
  batchId: string;
  employerId: string;
  fileType: "EVENTS";
  sourceSystem: SourceSystem;
  status: BatchStatus;
  executionDate: IsoDate;
  rawFileId: string;
  uploadedBy: string;
  receivedAt: string;
  updatedAt: string;
  counts: BatchCounts;
  failureReason?: string;
  fileSha256: string;
}

export type EncodingDetected = "windows-1252" | "utf-8" | "utf-8-bom";

export interface RawFile {
  rawFileId: string;
  originalFilename: string;
  sha256: string;
  sizeBytes: number;
  encodingDetected: EncodingDetected;
  lakePath: string;
  receivedAt: string;
}

export interface BatchStatusHistoryEntry {
  id: number;
  batchId: string;
  fromStatus: BatchStatus | null;
  toStatus: BatchStatus;
  actor: string;
  at: string;
  note: string | null;
}

export type FindingLevel = "L0" | "L1" | "L2";
export const FINDING_SEVERITIES = ["FILE_ERROR", "COMPLETE_MEMBER_ERROR", "WARNING", "INFORMATION"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export const FINDING_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export type FindingVisibility = (typeof FINDING_VISIBILITIES)[number];

export type FindingParams = Record<string, string | number>;

export interface ValidationFinding {
  findingId: string;
  batchId: string;
  recordId: string | null;
  lineNumber: number | null;
  sinPseudo: string | null;
  ruleId: string;
  messageId: string;
  level: FindingLevel;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  field: EventsCsvColumn | "DateOfDeath" | null;
  yearScope: YearScope | null;
  params: FindingParams;
  dataImportMessage: string;
  portalMessage: string;
  overrideReasons: string[];
  override?: { reason: string; actor: string; at: string; note?: string };
  calculated?: Record<string, string | number | boolean>;
  createdAt: string;
  /** Deterministic position within the record's findings. */
  sortOrder: number;
}
