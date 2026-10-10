import type { ArielUpdateItemCore, EventType, IsoDate } from "@/types";
import { csvLine } from "@/lib/pipeline/csv-out";

/**
 * Export payload handed to a format. This is the ONLY structure in the application that carries raw SINs
 * (architecture section 13.3): it exists in memory inside the export writer and in the export directory.
 */
export interface ExportMember {
  sin: string;
  sinMasked: string;
  sinPseudo: string;
  lastName: string | null;
  firstName: string | null;
  employerId: string;
  lineNumber: number;
  eventType: EventType;
  eventDate: IsoDate;
  items: ArielUpdateItemCore[];
}

export interface ExportPayload {
  schemaVersion: 1;
  exportId: string;
  updateSetId: string;
  batchId: string;
  employerId: string;
  executionDate: IsoDate;
  contentHash: string;
  exportedAt: string;
  exportedBy: string;
  itemCount: number;
  memberCount: number;
  members: ExportMember[];
}

/**
 * Pluggable target format. The real HOOPP Data Controller / APX load layout is not yet specified; adding it is
 * a new implementation here and nothing in the derivation changes.
 */
export interface ArielExportFormat {
  readonly id: "json" | "csv";
  readonly filename: string;
  readonly contentType: string;
  render(payload: ExportPayload): Buffer;
}

export const jsonExportFormat: ArielExportFormat = {
  id: "json",
  filename: "ariel-update-set.json",
  contentType: "application/json; charset=utf-8",
  render(payload) {
    return Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf8");
  },
};

const CSV_HEADER = ["SIN", "LastName", "FirstName", "EmployerId", "EventType", "EventDate", "Line", "RecordType", "Operation", "YearScope", "DerivationRule", "TargetKey", "Field", "Before", "After"];

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** One row per item field; SIN in the first column as the loader expects. */
export const csvExportFormat: ArielExportFormat = {
  id: "csv",
  filename: "ariel-update-set.csv",
  contentType: "text/csv; charset=utf-8",
  render(payload) {
    const lines = [csvLine(CSV_HEADER)];
    for (const m of payload.members) {
      for (const it of m.items) {
        const names = Object.keys(it.fields).length ? Object.keys(it.fields) : Object.keys(it.before ?? {});
        for (const f of names) {
          lines.push(csvLine([m.sin, m.lastName, m.firstName, m.employerId, m.eventType, m.eventDate, String(m.lineNumber), it.recordType, it.operation, it.yearScope ?? "", it.derivationRule, JSON.stringify(it.targetKey), f, cell(it.before?.[f]), it.operation === "DELETE" ? "" : cell(it.fields[f])]));
        }
      }
    }
    return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
  },
};

export const EXPORT_FORMATS: Record<"json" | "csv", ArielExportFormat> = { json: jsonExportFormat, csv: csvExportFormat };

export function formatsFor(request: "json" | "csv" | "both"): ArielExportFormat[] {
  return request === "both" ? [jsonExportFormat, csvExportFormat] : [EXPORT_FORMATS[request]];
}