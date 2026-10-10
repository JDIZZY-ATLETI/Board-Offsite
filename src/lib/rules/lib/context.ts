import Decimal from "decimal.js";
import type { FileDerived } from "@/lib/derivation/provisional";
import type { DecimalString, EventsRecord, YearBlock, YearScope } from "@/types";
import type { RuleContext } from "../types";

/** FileDerived for the record or null (unknown SIN / no employment / no event date). */
export function derivedFor(record: EventsRecord | null, ctx: RuleContext): FileDerived | null {
  if (!record) return null;
  return ctx.derived(record);
}

export function block(record: EventsRecord, scope: YearScope): YearBlock {
  return scope === "CURRENT" ? record.currentYear : record.previousYear;
}

export const SCOPES: readonly YearScope[] = ["CURRENT", "PREVIOUS"];

/** Previous-year evaluation is skipped when every previous-year field is null (architecture section 7.3). */
export function scopePresent(record: EventsRecord, scope: YearScope): boolean {
  if (scope === "CURRENT") return true;
  const b = record.previousYear;
  return [b.weeks, b.lowContributions, b.highContributions, b.annualizedEarnings, b.pa].some((v) => v !== null);
}

export function dec(v: DecimalString | null | undefined): Decimal | null {
  return typeof v === "string" ? new Decimal(v) : null;
}

export function gt0(v: DecimalString | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  return new Decimal(v).gt(0);
}

export function isZero(v: DecimalString | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  return new Decimal(v).isZero();
}

/** Blank or zero (B19b "0 or blank"; B181 "= 0" treats blank High as 0). */
export function zeroOrBlank(v: DecimalString | number | null | undefined): boolean {
  return v === null || v === undefined || new Decimal(v).isZero();
}

/** Retirement-notice marker in Employment.OtherInformation (B112/B113). */
export const RET_NOTICE_RE = /^RetNotice \d{4}-\d{2}-\d{2}$/;

/** Summary attribute written by the MDC Core Data load; matched dash-insensitively. */
export function isMdcCoreData(summaryAttribute: string): boolean {
  return summaryAttribute.replace(/[\u2013\u2014-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase() === "mdc - core data";
}