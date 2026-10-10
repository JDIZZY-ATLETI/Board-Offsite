import type { ValidationFinding } from "@/types";
import { csvLine } from "./csv-out";

export interface SummaryRow {
  section: "FILE_FORMAT" | "BUSINESS";
  ruleId: string;
  messageId: string;
  level: string;
  severity: string;
  visibility: string;
  findings: number;
  rows: number;
  overridden: number;
  portalMessage: string;
}

/** Summary of Validations rows (legacy D0000Val / D0000typ), grouped by rule + message id. */
export function summarizeFindings(findings: ValidationFinding[], includePrivate: boolean): SummaryRow[] {
  const m = new Map<string, SummaryRow & { lines: Set<number> }>();
  for (const f of findings) {
    if (!includePrivate && f.visibility !== "PUBLIC") continue;
    const key = `${f.ruleId}|${f.messageId}`;
    const row = m.get(key) ?? { section: f.level === "L2" ? "BUSINESS" : "FILE_FORMAT", ruleId: f.ruleId, messageId: f.messageId, level: f.level, severity: f.severity, visibility: f.visibility, findings: 0, rows: 0, overridden: 0, portalMessage: f.portalMessage, lines: new Set<number>() };
    row.findings += 1;
    if (f.lineNumber !== null) row.lines.add(f.lineNumber);
    if (f.override) row.overridden += 1;
    m.set(key, row);
  }
  const order = { FILE_ERROR: 0, COMPLETE_MEMBER_ERROR: 1, WARNING: 2, INFORMATION: 3 } as Record<string, number>;
  return [...m.values()]
    .map(({ lines, ...r }) => ({ ...r, rows: lines.size }))
    .sort((a, b) => (a.section === b.section ? 0 : a.section === "BUSINESS" ? -1 : 1) || (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.findings - a.findings || a.ruleId.localeCompare(b.ruleId) || a.messageId.localeCompare(b.messageId));
}

export function buildSummaryOfValidationsCsv(findings: ValidationFinding[], opts: { includePrivate: boolean }): string {
  const rows = summarizeFindings(findings, opts.includePrivate);
  const header = ["Section", "Rule", "MessageID", "Level", "Severity", ...(opts.includePrivate ? ["Visibility"] : []), "Findings", "Rows", "Overridden", "PortalMessage"];
  const lines = [csvLine(header)];
  for (const r of rows) {
    lines.push(csvLine([r.section, r.ruleId, r.messageId, r.level, r.severity, ...(opts.includePrivate ? [r.visibility] : []), String(r.findings), String(r.rows), String(r.overridden), r.portalMessage.trim()]));
  }
  return lines.join("\r\n") + "\r\n";
}