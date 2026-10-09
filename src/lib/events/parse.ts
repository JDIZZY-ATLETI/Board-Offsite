import { parse } from "csv-parse/sync";
import { EVENTS_CSV_COLUMNS, OPTIONAL_CSV_COLUMNS, type AnyCsvColumn, type EncodingDetected, type RawEventsRow, type RawValues } from "@/types";
import { decodeBytes } from "./decode";

export interface HeaderAnalysis {
  /** Header labels as observed (trimmed, BOM removed). */
  observed: string[];
  /** Labels not in the layout. */
  unknown: string[];
  duplicates: string[];
  /** Layout columns absent from the header (allowed; I1 reports mandatory ones per row). */
  missing: AnyCsvColumn[];
  empty: boolean;
}

export interface ParsedEventsFile {
  encoding: EncodingDetected;
  delimiter: ",";
  header: HeaderAnalysis;
  rows: RawEventsRow[];
  /** Physical lines in the file including the header. */
  lineCount: number;
}

const KNOWN: ReadonlySet<string> = new Set<string>([...EVENTS_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS]);

export function analyseHeader(cells: string[] | undefined): HeaderAnalysis {
  if (!cells || cells.length === 0 || cells.every((c) => c.trim() === "")) {
    return { observed: [], unknown: [], duplicates: [], missing: [...EVENTS_CSV_COLUMNS], empty: true };
  }
  const observed = cells.map((c) => c.replace(/^\uFEFF/, "").trim());
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const label of observed) {
    if (!KNOWN.has(label)) unknown.push(label);
    if (seen.has(label)) duplicates.push(label);
    seen.add(label);
  }
  const missing = [...EVENTS_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS].filter((c) => !seen.has(c));
  return { observed, unknown, duplicates: [...new Set(duplicates)], missing, empty: false };
}

function emptyValues(): RawValues {
  const v = {} as RawValues;
  for (const c of EVENTS_CSV_COLUMNS) v[c] = null;
  return v;
}

/** Maps a physical row onto the observed header. Cells beyond the header width are kept for I50. */
export function mapRow(header: string[], cells: string[], lineNumber: number): RawEventsRow {
  const values = emptyValues();
  const extraValues: string[] = [];
  cells.forEach((cell, i) => {
    if (i >= header.length) {
      extraValues.push(cell);
      return;
    }
    const col = header[i];
    if (KNOWN.has(col)) {
      (values as Record<string, string | null>)[col] = cell === "" ? null : cell;
    }
  });
  return { lineNumber, values, extraValues };
}

/**
 * Strict Events CSV parse: comma delimited, header row, quoted cells allowed, ragged rows tolerated so
 * that I50 can observe extra cells. Never throws on content; structural issues surface as header flags.
 */
export function parseEventsCsv(bytes: Buffer): ParsedEventsFile {
  const { text, encoding } = decodeBytes(bytes);
  const lineCount = text === "" ? 0 : text.split(/\r\n|\n|\r/).filter((l, i, arr) => !(i === arr.length - 1 && l === "")).length;
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(text, {
      delimiter: ",",
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
      info: true,
    }) as unknown as Array<{ record: string[]; info: { lines: number } }>;
  } catch {
    // Unparseable structure (e.g. unterminated quote): treat as a file with an unreadable header.
    return { encoding, delimiter: ",", header: analyseHeader(undefined), rows: [], lineCount };
  }
  if (records.length === 0) {
    return { encoding, delimiter: ",", header: analyseHeader(undefined), rows: [], lineCount };
  }
  const header = analyseHeader(records[0].record);
  const rows = records.slice(1).map((r) => mapRow(header.observed, r.record, r.info.lines));
  return { encoding, delimiter: ",", header, rows, lineCount };
}
