import type { BatchStatus } from "./batch";

export interface RuleTiming {
  ruleId: string;
  level: string;
  evaluations: number;
  findings: number;
  durationMs: number;
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
  failureReason?: string;
}
