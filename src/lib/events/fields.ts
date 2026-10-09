import Decimal from "decimal.js";
import type { DecimalString, IsoDate } from "@/types";

export type FieldParse<T> = { ok: true; value: T } | { ok: false; reason: FieldFailure };
export type FieldFailure = "NOT_NUMERIC" | "TOO_MANY_DECIMALS" | "NOT_INTEGER" | "INVALID_DATE";

const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const INTEGER_RE = /^\d+$/;

export function isBlank(v: string | null | undefined): v is null | undefined | "" {
  return v === null || v === undefined || v.trim() === "";
}

/** Decimal data type (I7): numeric, "." decimal symbol, at most two decimal places. */
export function parseDecimalField(raw: string): FieldParse<DecimalString> {
  const t = raw.trim();
  if (!NUMERIC_RE.test(t)) return { ok: false, reason: "NOT_NUMERIC" };
  const dot = t.indexOf(".");
  const decimals = dot === -1 ? 0 : t.length - dot - 1;
  if (decimals > 2) return { ok: false, reason: "TOO_MANY_DECIMALS" };
  return { ok: true, value: new Decimal(t).toFixed(2) };
}

/** Integer data type (I8): whole number, no decimal, fraction or negative sign. */
export function parseIntegerField(raw: string): FieldParse<number> {
  const t = raw.trim();
  if (!INTEGER_RE.test(t)) return { ok: false, reason: "NOT_INTEGER" };
  const n = Number(t);
  if (!Number.isSafeInteger(n)) return { ok: false, reason: "NOT_INTEGER" };
  return { ok: true, value: n };
}

/** Numeric sign test on the raw string, independent of decimal-place validity (B187 runs even when I7 fires). */
export function numericValue(raw: string | null | undefined): Decimal | null {
  if (isBlank(raw)) return null;
  const t = raw.trim();
  if (!NUMERIC_RE.test(t)) return null;
  return new Decimal(t);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date data type (I5): left-pad to 8 with "0", then MMDDYYYY with valid MM/DD/YYYY. */
export function parseDateField(raw: string): FieldParse<IsoDate> {
  const t = raw.trim();
  if (!/^\d{1,8}$/.test(t)) return { ok: false, reason: "INVALID_DATE" };
  const s = t.padStart(8, "0");
  const mm = Number(s.slice(0, 2));
  const dd = Number(s.slice(2, 4));
  const yyyy = Number(s.slice(4, 8));
  if (mm < 1 || mm > 12 || dd < 1 || yyyy < 1900 || yyyy > 2999) return { ok: false, reason: "INVALID_DATE" };
  if (dd > daysInMonth(yyyy, mm)) return { ok: false, reason: "INVALID_DATE" };
  return { ok: true, value: `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` as IsoDate };
}

export function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}

export function todayIso(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10) as IsoDate;
}

/** Spec convention MM-DD-YYYY for dates rendered inside messages (architecture section 7.4). */
export function formatMessageDate(d: IsoDate): string {
  return `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(0, 4)}`;
}
