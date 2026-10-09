import { parse } from "csv-parse/sync";
import { EVENTS_CSV_COLUMNS, OPTIONAL_CSV_COLUMNS, type AnyCsvColumn, type EncodingDetected, type RawEventsRow, type RawValues } from "@/types";
import { decodeBytes, detectEncodingProblem, type EncodingProblem } from "./decode";

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
  /** Set when the bytes cannot be an ANSI/UTF-8 CSV (UTF-16, NUL bytes); header and rows are then empty. */
  encodingProblem: EncodingProblem | null;
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
  const encodingProblem = detectEncodingProblem(bytes);
  if (encodingProblem) {
    return { encoding: "windows-1252", delimiter: ",", header: analyseHeader(undefined), rows: [], lineCount: 0, encodingProblem };
  }
  const { text, encoding } = decodeBytes(bytes);
  const lineCount = countLines(text);
  let records: ParsedRecord[];
  try {
    records = parse(text, {
      delimiter: ",",
      // Mixed CRLF / LF / CR files are common from spreadsheet round-trips (QA BUG-PARSE-1).
      record_delimiter: ["\r\n", "\n", "\r"],
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
      info: true,
    }) as unknown as ParsedRecord[];
  } catch {
    // Unparseable structure (e.g. unterminated quote): treat as a file with an unreadable header.
    return { encoding, delimiter: ",", header: analyseHeader(undefined), rows: [], lineCount, encodingProblem: null };
  }
  if (records.length === 0) {
    return { encoding, delimiter: ",", header: analyseHeader(undefined), rows: [], lineCount, encodingProblem: null };
  }
  const header = analyseHeader(records[0].record);
  // csv-parse `info.lines` is the line on which the record ENDS and counts CR and LF of a quoted CRLF
  // separately, so rows after a multi-line cell drift (QA BUG-PARSE-2). Recover the physical start line.
  let excess = 0;
  const rows: RawEventsRow[] = [];
  records.forEach((r, i) => {
    const nl = newlinesInside(r.record);
    if (i > 0) rows.push(mapRow(header.observed, r.record, r.info.lines - excess - nl.counted));
    excess += nl.counted - nl.physical;
  });
  return { encoding, delimiter: ",", header, rows, lineCount, encodingProblem: null };
}

interface ParsedRecord {
  record: string[];
  info: { lines: number; bytes: number };
}

/** Physical line count, delimiter-agnostic (CRLF / LF / CR), ignoring a trailing terminator. */
export function countLines(text: string): number {
  return text === "" ? 0 : text.split(/\r\n|\n|\r/).filter((l, i, arr) => !(i === arr.length - 1 && l === "")).length;
}

/** Newlines inside quoted cells: as csv-parse counts them (CR and LF each) vs physical line breaks. */
function newlinesInside(cells: string[]): { counted: number; physical: number } {
  let crlf = 0;
  let lone = 0;
  for (const cell of cells) {
    for (let i = 0; i < cell.length; i++) {
      const c = cell.charCodeAt(i);
      if (c === 13) {
        if (cell.charCodeAt(i + 1) === 10) {
          crlf += 1;
          i += 1;
        } else lone += 1;
      } else if (c === 10) lone += 1;
    }
  }
  return { counted: 2 * crlf + lone, physical: crlf + lone };
}
