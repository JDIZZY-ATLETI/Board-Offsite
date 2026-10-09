import { EVENTS_CSV_COLUMNS, OPTIONAL_CSV_COLUMNS } from "@/types/events";

/** Columns that may be blank/absent without an I51 rejection (architecture section 18 Q1 + optional PY fields). */
export const PREFLIGHT_OPTIONAL_COLUMNS: ReadonlySet<string> = new Set<string>([...OPTIONAL_CSV_COLUMNS, "HighContributions_PreviousYear"]);

export type PreflightState = "ok" | "warn" | "error" | "empty";

export interface PreflightResult {
  state: PreflightState;
  observed: string[];
  missing: string[];
  missingOptional: string[];
  unknown: string[];
  duplicates: string[];
  /** `{ unknown -> closest known }` for "Did you mean…". */
  suggestions: Record<string, string>;
  bom: boolean;
  /** Data rows seen in the sampled bytes (lower bound when the file is larger than the sample). */
  rowCountSample: number;
  sampleComplete: boolean;
}

/** Splits a header line on commas (strips quotes); the server parser is authoritative. */
export function splitHeader(line: string): string[] {
  return line
    .replace(/\r$/, "")
    .split(",")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1").trim());
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

export function closestColumn(name: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of EVENTS_CSV_COLUMNS) {
    const d = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best !== null && bestD <= Math.min(4, Math.floor(name.length / 2)) ? best : null;
}

/**
 * Client-side header pre-flight (docs/ux-design.md section 5.2): case-sensitive, order-insensitive match
 * against EVENTS_CSV_COLUMNS, like I51. Advisory only; the server's L0 rules decide.
 */
export function preflightHeader(sampleText: string, sampleComplete: boolean): PreflightResult {
  const bom = sampleText.charCodeAt(0) === 0xfeff;
  const text = bom ? sampleText.slice(1) : sampleText;
  const lines = text.split("\n");
  const headerLine = lines[0] ?? "";
  const observed = headerLine.trim() === "" ? [] : splitHeader(headerLine);
  const dataLines = lines.slice(1).filter((l) => l.trim() !== "");
  const rowCountSample = sampleComplete ? dataLines.length : Math.max(0, dataLines.length - 1);

  if (observed.length === 0 || (observed.length === 1 && observed[0] === "")) {
    return { state: "empty", observed: [], missing: [...EVENTS_CSV_COLUMNS], missingOptional: [], unknown: [], duplicates: [], suggestions: {}, bom, rowCountSample, sampleComplete };
  }

  const known = new Set<string>([...EVENTS_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS]);
  const seen = new Map<string, number>();
  for (const c of observed) seen.set(c, (seen.get(c) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  const unknown = observed.filter((c) => !known.has(c));
  const missingAll = EVENTS_CSV_COLUMNS.filter((c) => !seen.has(c));
  const missing = missingAll.filter((c) => !PREFLIGHT_OPTIONAL_COLUMNS.has(c));
  const missingOptional = missingAll.filter((c) => PREFLIGHT_OPTIONAL_COLUMNS.has(c));
  const suggestions: Record<string, string> = {};
  for (const u of unknown) {
    const s = closestColumn(u);
    if (s && (missingAll as readonly string[]).includes(s)) suggestions[u] = s;
  }
  const state: PreflightState = unknown.length || duplicates.length || missing.length ? "error" : missingOptional.length ? "warn" : "ok";
  return { state, observed, missing, missingOptional, unknown, duplicates, suggestions, bom, rowCountSample, sampleComplete };
}

export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads the first `maxBytes` of a file as text (windows-1252 fallback to latin1 keeps ASCII headers intact). */
export async function readHead(file: Blob, maxBytes = 64 * 1024): Promise<{ text: string; complete: boolean }> {
  const slice = file.slice(0, maxBytes);
  const buf = await slice.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1252").decode(buf);
  }
  return { text, complete: file.size <= maxBytes };
}

export function headerTemplateCsv(): string {
  return `${EVENTS_CSV_COLUMNS.join(",")}\r\n`;
}