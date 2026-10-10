import type { ArielEmployment, IsoDate } from "@/types";
import { dec31, endOrOpen, jan1 } from "./dates";

/** Any LTD break overlapping the calendar year (break end is exclusive). */
export function ltdBreakIn(emp: ArielEmployment, year: number) {
  return emp.serviceBreaks.filter((b) => b.type === "LTD" && b.startDate <= dec31(year) && endOrOpen(b.endDate) > jan1(year));
}

/** True when the employment type is PT on at least one day of the year. */
export function isPartTimeAnyDay(emp: ArielEmployment, year: number): boolean {
  const history = emp.employmentTypeHistory.length ? [...emp.employmentTypeHistory].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)) : [{ type: emp.employmentType, effectiveDate: emp.permanencyDate }];
  const start = jan1(year);
  const end = dec31(year);
  let current = history.filter((h) => h.effectiveDate <= start).pop() ?? null;
  if (!current) current = history[0];
  if (current.type === "PT") return true;
  return history.some((h) => h.effectiveDate > start && h.effectiveDate <= end && h.type === "PT");
}

/** A break of the given types covering [windowStart .. windowEnd] (B19/B19b WSO logic, B22 LTD logic). */
export function breakCovering(emp: ArielEmployment, type: string, startAtOrBefore: IsoDate, endAfter: IsoDate, endInclusive = false) {
  return emp.serviceBreaks.find((b) => b.type === type && b.startDate <= startAtOrBefore && (endInclusive ? endOrOpen(b.endDate) >= endAfter : endOrOpen(b.endDate) > endAfter)) ?? null;
}