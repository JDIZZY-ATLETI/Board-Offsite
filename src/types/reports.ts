import type { BatchStatus } from "./batch";

export interface RuleTiming {
  ruleId: string;
  level: string;
  evaluations: number;
  findings: number;
  durationMs: number;
  /** Evaluations that produced no finding because an input was unavailable (e.g. a rate-table year). */
  skipped?: number;
}

export interface ExecutionReport {
  schemaVersion: 1;
  batchId: string;
  status: BatchStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  parameters: {
    employerId: string;
    executionDate: string;
    sourceSystem: string;
    uploadedBy: string;
    rulesConfigHash: string;
    arielAdapter?: string;
    arielSnapshotHash?: string;
  };
  input: {
    originalFilename: string;
    sha256: string;
    sizeBytes: number;
    encodingDetected: string;
    lineCount: number;
  };
  outputs: string[];
  counts: {
    linesRead: number;
    rows: number;
    accepted: number;
    rejected: number;
    held?: number;
    fileErrors: number;
    memberErrors: number;
    warnings: number;
    infos: number;
    findings: number;
  };
  rules: RuleTiming[];
  /** Per-record rule skips (BUG-L2-RATES-1): the row was evaluated without the rule; reason is machine-readable. */
  ruleSkips?: Array<{ ruleId: string; lineNumber: number; reason: string }>;
  failureReason?: string;
}
