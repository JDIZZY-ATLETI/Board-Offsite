import { encodeText } from "@/lib/events/decode";
import type { EncodingDetected, EventsRecord } from "@/types";

const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * CSV cell escaping with formula-injection hardening (architecture section 13.2). Negative numbers are
 * left intact so the Rejected Individuals file stays reloadable.
 */
export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let v = value;
  const first = v[0];
  if ((first === "=" || first === "@" || first === "\t" || first === "\r") || ((first === "+" || first === "-") && !NUMERIC_RE.test(v.trim()))) {
    v = `'${v}`;
  }
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvLine(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

/**
 * Rejected Individuals (legacy `Rejected_FileName.csv`): same columns as the input header, original
 * values, raw SIN. This is the only artifact outside the export directory allowed to carry a raw SIN.
 */
export function buildRejectedIndividualsCsv(header: string[], rejected: EventsRecord[], encoding: EncodingDetected): Buffer {
  const lines = [csvLine(header)];
  for (const r of rejected) {
    lines.push(csvLine(header.map((col) => (col === "SIN" ? (r.rawValues.SIN ?? "") : ((r.rawValues as Record<string, string | null>)[col] ?? "")))));
  }
  return encodeText(lines.join("\r\n") + "\r\n", encoding);
}
