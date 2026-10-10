import Decimal from "decimal.js";
import type { ArielRateTables, DecimalString, RateTableName, RateTableRow } from "@/types";

export class RateTableMissingError extends Error {
  constructor(table: RateTableName, year: number) {
    super(`rate table ${table} has no value for year ${year}`);
    this.name = "RateTableMissingError";
  }
}

/** In-memory rate tables (architecture section 4.6 / 18 Q9). Pure; safe to share across rules. */
export class StaticRateTables implements ArielRateTables {
  private readonly map = new Map<string, RateTableRow>();
  constructor(rows: RateTableRow[]) {
    for (const r of rows) this.map.set(`${r.table}:${r.year}`, { ...r, value: new Decimal(r.value).toString() });
  }
  private get(table: RateTableName, year: number): DecimalString {
    const r = this.map.get(`${table}:${year}`);
    if (!r) throw new RateTableMissingError(table, year);
    return r.value;
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
  rows(): RateTableRow[] {
    return [...this.map.values()].sort((a, b) => a.table.localeCompare(b.table) || a.year - b.year);
  }
}

/** Placeholder tables 2015-2026 (architecture section 18 Q9). Every row is flagged `placeholder: true`. */
export function placeholderRateRows(): RateTableRow[] {
  const ympe: Record<number, number> = { 2015: 53600, 2016: 54900, 2017: 55300, 2018: 55900, 2019: 57400, 2020: 58700, 2021: 61600, 2022: 64900, 2023: 66600, 2024: 68500, 2025: 71300, 2026: 74600 };
  const paMax: Record<number, number> = { 2015: 25370, 2016: 26010, 2017: 26230, 2018: 26500, 2019: 27230, 2020: 27830, 2021: 29210, 2022: 30780, 2023: 31560, 2024: 32490, 2025: 33810, 2026: 34416 };
  const rows: RateTableRow[] = [];
  for (let y = 2015; y <= 2026; y++) {
    rows.push({ table: "MGA", year: y, value: String(ympe[y]), placeholder: true });
    rows.push({ table: "PAMAXDB", year: y, value: String(paMax[y]), placeholder: true });
    rows.push({ table: "REDFE", year: y, value: "600", placeholder: true });
    rows.push({ table: "LOWRATE", year: y, value: "0.069", placeholder: true });
    rows.push({ table: "HIGHRATE", year: y, value: "0.092", placeholder: true });
  }
  return rows;
}