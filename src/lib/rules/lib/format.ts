import Decimal from "decimal.js";

/** Architecture section 7.4: money as #,##0.00 inside messages. */
export function money(v: Decimal | number | string): string {
  const d = new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const [int, frac] = d.toFixed(2).split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  return `${neg ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

export function weeks2(v: Decimal | number | string): string {
  return new Decimal(v).toFixed(2);
}

export function whole(v: Decimal | number | string): number {
  return new Decimal(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function pct2(v: Decimal): string {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}