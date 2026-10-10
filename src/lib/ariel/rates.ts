import Decimal from "decimal.js";
import { RATE_TABLE_NAMES, type ArielRateTables, type DecimalString, type RateTableName, type RateTableRow } from "@/types";

/** Reason string recorded when a rule skips because a rate row is absent (Phase 2 QA BUG-L2-RATES-1). */
export function rateMissingReason(table: RateTableName, year: number): string {
  return `RATE_MISSING:${table}:${year}`;
}

/** First table without a value for `year`, or null when the year is fully covered. */
export function missingRateTable(rates: ArielRateTables, year: number): RateTableName | null {
  const probes: Array<[RateTableName, DecimalString | null]> = [
    ["MGA", rates.ympe(year)],
    ["PAMAXDB", rates.paMaxDb(year)],
    ["REDFE", rates.paOffset(year)],
    ["LOWRATE", rates.lowContributionRate(year)],
    ["HIGHRATE", rates.highContributionRate(year)],
  ];
  return probes.find(([, v]) => v === null)?.[0] ?? null;
}

/** In-memory rate tables (architecture section 4.6 / 18 Q9). Pure; safe to share across rules. Never throws. */
export class StaticRateTables implements ArielRateTables {
  private readonly map = new Map<string, RateTableRow>();
  constructor(rows: RateTableRow[]) {
    for (const r of rows) this.map.set(`${r.table}:${r.year}`, { ...r, value: new Decimal(r.value).toString() });
  }
  private get(table: RateTableName, year: number): DecimalString | null {
    return this.map.get(`${table}:${year}`)?.value ?? null;
  }
  ympe(year: number) {
    return this.get("MGA", year);
  }
  paMaxDb(year: number) {
    return this.get("PAMAXDB", year);
  }
  paOffset(year: number) {
    return this.get("REDFE", year);
  }
  lowContributionRate(year: number) {
    return this.get("LOWRATE", year);
  }
  highContributionRate(year: number) {
    return this.get("HIGHRATE", year);
  }
  firstYear(): number | null {
    const years = [...new Set([...this.map.values()].map((r) => r.year))].sort((a, b) => a - b);
    return years.find((y) => RATE_TABLE_NAMES.every((t) => this.map.has(`${t}:${y}`))) ?? null;
  }
  rows(): RateTableRow[] {
    return [...this.map.values()].sort((a, b) => a.table.localeCompare(b.table) || a.year - b.year);
  }
}

/** First and last year covered by the placeholder tables (architecture section 18 Q9). */
export const PLACEHOLDER_RATE_YEARS = { first: 2010, last: 2027 } as const;

/** Placeholder tables 2010-2027 (architecture section 18 Q9). Every row is flagged `placeholder: true`. */
export function placeholderRateRows(): RateTableRow[] {
  const ympe: Record<number, number> = {
    2010: 47200, 2011: 48300, 2012: 50100, 2013: 51100, 2014: 52500,
    2015: 53600, 2016: 54900, 2017: 55300, 2018: 55900, 2019: 57400, 2020: 58700, 2021: 61600, 2022: 64900, 2023: 66600, 2024: 68500, 2025: 71300, 2026: 74600,
    2027: 77000,
  };
  const paMax: Record<number, number> = {
    2010: 22450, 2011: 22970, 2012: 23820, 2013: 24270, 2014: 24930,
    2015: 25370, 2016: 26010, 2017: 26230, 2018: 26500, 2019: 27230, 2020: 27830, 2021: 29210, 2022: 30780, 2023: 31560, 2024: 32490, 2025: 33810, 2026: 34416,
    2027: 35500,
  };
  const rows: RateTableRow[] = [];
  for (let y = PLACEHOLDER_RATE_YEARS.first; y <= PLACEHOLDER_RATE_YEARS.last; y++) {
    rows.push({ table: "MGA", year: y, value: String(ympe[y]), placeholder: true });
    rows.push({ table: "PAMAXDB", year: y, value: String(paMax[y]), placeholder: true });
    rows.push({ table: "REDFE", year: y, value: "600", placeholder: true });
    rows.push({ table: "LOWRATE", year: y, value: "0.069", placeholder: true });
    rows.push({ table: "HIGHRATE", year: y, value: "0.092", placeholder: true });
  }
  return rows;
}