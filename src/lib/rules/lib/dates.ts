import type { IsoDate } from "@/types";

/** Civil-date helpers on YYYY-MM-DD strings (architecture section 7.6: day counts on civil dates). */
export const OPEN_END: IsoDate = "2200-12-31";

export function toUtc(d: IsoDate): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

export function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

/** b - a in whole days (exclusive of b). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtc(toUtc(d) + n * 86_400_000);
}

export function addYears(d: IsoDate, n: number): IsoDate {
  const y = Number(d.slice(0, 4)) + n;
  const md = d.slice(5);
  // Feb 29 -> Feb 28 when the target year is not leap.
  if (md === "02-29" && !isLeap(y)) return `${y}-02-28` as IsoDate;
  return `${y}-${md}` as IsoDate;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInYear(y: number): number {
  return isLeap(y) ? 366 : 365;
}

export function jan1(y: number): IsoDate {
  return `${y}-01-01` as IsoDate;
}

export function dec31(y: number): IsoDate {
  return `${y}-12-31` as IsoDate;
}

export function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}

export function maxDate(...ds: IsoDate[]): IsoDate {
  return ds.reduce((a, b) => (a >= b ? a : b));
}

export function minDate(...ds: IsoDate[]): IsoDate {
  return ds.reduce((a, b) => (a <= b ? a : b));
}

/** Open-ended breaks compare as the legacy sentinel 2200-12-31. */
export function endOrOpen(d: IsoDate | null): IsoDate {
  return d ?? OPEN_END;
}

/** Spec convention MM-DD-YYYY inside DataImport messages (architecture section 7.4). */
export function messageDate(d: IsoDate): string {
  return `${d.slice(5, 7)}-${d.slice(8, 10)}-${d.slice(0, 4)}`;
}