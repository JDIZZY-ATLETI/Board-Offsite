/**
 * Display formatting (docs/ux-design.md section 7.3). Locale en-CA, 24-hour clock.
 * Strings coming from the API (decimal strings) are never re-rounded beyond 2 dp.
 */

const ELLIPSIS = "\u2026";
const MINUS = "\u2212";
const THIN_SPACE = "\u2009";

/** `9f86d081…0a08`: first 8 + ellipsis + last 4. Short inputs are returned as-is. */
export function shortId(value: string | null | undefined, head = 8, tail = 4): string {
  if (!value) return "\u2014";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}${ELLIPSIS}${value.slice(-tail)}`;
}

export const shortHash = shortId;

/** Batch ids are UUID v7: first 8 hex chars + last 4. */
export function shortBatchId(batchId: string): string {
  return shortId(batchId.replace(/-/g, ""), 8, 4);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Timestamp -> `yyyy-mm-dd HH:mm` in the viewer's local zone. */
export function formatDateTime(iso: string | Date | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (!iso) return "\u2014";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  const base = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return opts.seconds ? `${base}:${pad2(d.getSeconds())}` : base;
}

/** `HH:mm` only (stepper timestamps). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** UTC ISO with milliseconds (the hashed representation shown in ledger tables). */
export function formatUtcIso(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString();
}

/** Civil date: already ISO `yyyy-mm-dd` in the domain; passes through, null -> em dash. */
export function formatIsoDate(date: string | null | undefined): string {
  return date ? date : "\u2014";
}

/** Raw MMDDYYYY (as typed in the file) -> ISO when well-formed, else null. */
export function mmddyyyyToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/** ISO -> MMDDYYYY for showing "file: 09302026" alongside. */
export function isoToMmddyyyy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}${m[3]}${m[1]}` : null;
}

/** Relative time with coarse units; always pair with an absolute `title`. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "\u2014";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);
  const diff = Math.max(0, now.getTime() - then);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDateTime(iso).slice(0, 10);
}

const intFmt = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

/** `#,##0` */
export function formatInt(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return n < 0 ? `${MINUS}${intFmt.format(Math.abs(n))}` : intFmt.format(n);
}

/**
 * `#,##0.00` for money and weeks. Accepts decimal strings and preserves the given precision up to 2 dp
 * (never rounds a 2-dp API string). Negative values use U+2212.
 */
export function formatDecimal(value: string | number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  const s = typeof value === "number" ? value.toFixed(dp) : String(value).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  const neg = m[1] === "-";
  const intPart = intFmt.format(Number(m[2]));
  const frac = (m[3] ?? "").padEnd(dp, "0").slice(0, Math.max(dp, (m[3] ?? "").length));
  return `${neg ? MINUS : ""}${intPart}${dp > 0 || frac ? `.${frac}` : ""}`;
}

export const formatMoney = (v: string | number | null | undefined) => formatDecimal(v, 2);
export const formatWeeks = (v: string | number | null | undefined) => formatDecimal(v, 2);

/** `6.8 %` with a thin space. */
export function formatPercent(ratio: number | null | undefined, dp = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "\u2014";
  return `${(ratio * 100).toFixed(dp)}${THIN_SPACE}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "\u2014";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** `ABLE, A.` -> `A.A.`-style initials from first/last names. */
export function initials(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const f = firstName?.trim()?.[0];
  const l = lastName?.trim()?.[0];
  if (!f && !l) return "";
  return `${f ? `${f.toUpperCase()}.` : ""}${l ? `${l.toUpperCase()}.` : ""}`;
}

/** `ABLE, Anna` display form for name columns. */
export function displayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const l = lastName?.trim();
  const f = firstName?.trim();
  if (l && f) return `${l.toUpperCase()}, ${f}`;
  return (l ?? f ?? "").toString();
}

/** `0235 · St. Michael's` (name optional in Phase 1). */
export function formatEmployer(employerId: string, name?: string | null): string {
  return name ? `${employerId} \u00b7 ${name}` : employerId;
}

/** Interpolates `{key}` placeholders. Missing keys are left as-is so gaps are visible. */
export function fillTemplate(template: string, values: Record<string, string | number | boolean | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = values[key];
    return v === null || v === undefined ? whole : String(v);
  });
}

/** Strips `user:` / `system:` prefixes for display; full actor stays in `title`. */
export function actorLabel(actor: string): string {
  const i = actor.indexOf(":");
  return i === -1 ? actor : actor.slice(i + 1);
}