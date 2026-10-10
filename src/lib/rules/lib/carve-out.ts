import type { ArielServiceBreak, IsoDate } from "@/types";
import { daysBetween, endOrOpen, maxDate, minDate } from "./dates";

export interface CarveWindow {
  /** First day of the window (inclusive). */
  start: IsoDate;
  /** Last day of the window (inclusive) - the spec's YearEnd / ValidationYear-12-31. */
  endInclusive: IsoDate;
  /** Exclusive clip bound for break end dates - the spec's (ValidationYear+1)-01-01 or termination date. */
  clipEnd: IsoDate;
}

export interface CarveResult {
  days: number;
  identified: Array<{ type: string; startDate: IsoDate; endDate: IsoDate }>;
}

/**
 * The spec's "IdentifiedBreaks" trim/merge algorithm (B184/B185/B186/B214), implemented literally: select,
 * clip each i to the window, then de-overlap pairwise against every later j, then sum (end - start) days.
 * Day counts exclude the end date.
 */
export function carveOut(breaks: ArielServiceBreak[], window: CarveWindow, types: ReadonlySet<string>): CarveResult {
  const identified = breaks
    .filter((b) => types.has(b.type) && b.startDate <= window.endInclusive && endOrOpen(b.endDate) > window.start)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || endOrOpen(a.endDate).localeCompare(endOrOpen(b.endDate)) || a.breakId.localeCompare(b.breakId))
    .map((b) => ({ type: b.type, startDate: b.startDate, endDate: endOrOpen(b.endDate) }));
  for (let i = 0; i < identified.length; i++) {
    const bi = identified[i];
    bi.startDate = maxDate(bi.startDate, window.start);
    bi.endDate = minDate(bi.endDate, window.clipEnd);
    for (let j = i + 1; j < identified.length; j++) {
      const bj = identified[j];
      if (bj.startDate >= bi.startDate && bj.startDate <= bi.endDate) {
        if (bj.endDate <= bi.endDate) bj.endDate = bj.startDate;
        else bi.endDate = bj.startDate;
      } else if (bj.endDate >= bi.startDate && bj.endDate <= bi.endDate) {
        bi.startDate = bj.endDate;
      } else if (bj.startDate < bi.startDate && bj.endDate > bi.endDate) {
        bi.endDate = bi.startDate;
      }
    }
  }
  let days = 0;
  for (const b of identified) days += Math.max(0, daysBetween(b.startDate, b.endDate));
  return { days, identified };
}

/** B184a/b/c carve-out types (R15 list). */
export const EXCESS_CARVE_TYPES: ReadonlySet<string> = new Set(["LTD", "NCM", "NCU", "WSN", "WSO", "PTW", "NCD"]);
/** B185 / B186a/b/c carve-out types. */
export const SHORTFALL_CARVE_TYPES: ReadonlySet<string> = new Set(["PAR", "LTD", "NCH", "NCF", "NCP", "NCS", "NCR", "NCE", "NCO", "NCU", "NCM", "WSN", "WSO", "PTW", "NCD"]);
/** B214 carve-out types; the CR* contributory-leave codes count only when not reported in this collect (always, for Events v1). */
export const B214_CARVE_TYPES: ReadonlySet<string> = new Set(["NCE", "NCF", "NCP", "NCS", "NCM", "NCD", "NCO", "NCU", "NCR", "NCH", "WSN", "WSO", "LTD", "PTW", "CRH", "CRE", "CRF", "CRP", "CRS", "CRM", "CRO", "CRR"]);
/** B214 "non-contributory leave" codes. */
export const NON_CONTRIBUTORY_LEAVE_TYPES: ReadonlySet<string> = new Set(["NCE", "NCF", "NCP", "NCS", "NCR", "NCO", "NCH"]);