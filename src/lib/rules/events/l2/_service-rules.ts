import type Decimal from "decimal.js";
import type { FileDerived } from "@/lib/derivation/provisional";
import type { EventsRecord, YearScope } from "@/types";
import { carveOut } from "../../lib/carve-out";
import { scopePresent } from "../../lib/context";
import { addDays, daysBetween, dec31, endOrOpen, jan1, maxDate, minDate } from "../../lib/dates";
import { weeks2 } from "../../lib/format";
import { arielService, expectedService, reportedService, totalYearDays, txView, type Rounding } from "../../lib/service";
import type { FindingDraft, RuleContext } from "../../types";

export type WindowKind = "fullYear" | "midYearEnrol" | "midYearTerm";

export interface ServiceEval {
  scope: YearScope;
  year: number;
  es: Decimal;
  rs: Decimal;
  ariel: Decimal;
  carveDays: number;
  totalDays: number;
  totalYear: number;
}

export interface ServiceRuleOptions {
  kind: WindowKind;
  carveTypes: ReadonlySet<string>;
  rounding: Rounding;
  includeRegul: boolean;
  /** B185 uses a strict "permanency < Jan 1" for the full-year test. */
  strictPermanency?: boolean;
}

/** Applicability + ES/RS for one year scope, following the B184/B185/B186 window definitions. */
export function evaluateServiceWindow(record: EventsRecord, d: FileDerived, ctx: RuleContext, scope: YearScope, o: ServiceRuleOptions): ServiceEval | null {
  if (!scopePresent(record, scope)) return null;
  const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
  const emp = d.employment;
  const y1 = jan1(year);
  const y31 = dec31(year);
  const perm = emp.permanencyDate;
  const eventDate = d.eventDate;
  // Q26: Ariel.Employment.TerminationDate is read as FileDerived.Employment.terminationDate (= the event date).
  const termDate = eventDate;
  const fullYearEvent = eventDate >= y31;
  let windowStart = y1;
  let windowEnd = y31;
  let clipStart = y1;
  let clipEnd = jan1(year + 1);
  switch (o.kind) {
    case "fullYear": {
      const enrolled = o.strictPermanency ? perm < y1 : perm <= y1;
      if (!enrolled || !fullYearEvent) return null;
      break;
    }
    case "midYearEnrol": {
      if (!(perm > y1 && perm <= y31)) return null;
      windowStart = maxDate(y1, perm);
      windowEnd = minDate(y31, termDate);
      clipStart = perm;
      clipEnd = minDate(endOrOpen(emp.terminationDate), jan1(year + 1), addDays(windowEnd, 1));
      break;
    }
    case "midYearTerm": {
      if (!(perm <= y1 && eventDate > y1 && eventDate < y31)) return null;
      windowStart = y1;
      windowEnd = minDate(y31, termDate, eventDate);
      clipEnd = addDays(windowEnd, 1);
      break;
    }
  }
  if (windowEnd < windowStart) return null;
  const view = txView(emp, d);
  const rs = reportedService(view, year, { includeRegul: o.includeRegul });
  const ariel = arielService(view, year, { includeRegul: o.includeRegul });
  const totalYear = totalYearDays(year);
  const carve = carveOut(emp.serviceBreaks, { start: windowStart, endInclusive: windowEnd, clipEnd }, o.carveTypes);
  const totalDays = o.kind === "fullYear" ? totalYear - carve.days : daysBetween(windowStart, windowEnd) + 1 - carve.days;
  void clipStart;
  const es = expectedService(totalDays, totalYear, o.rounding);
  return { scope, year, es, rs, ariel, carveDays: carve.days, totalDays, totalYear };
}

export function serviceDraft(e: ServiceEval, extra: Record<string, string | number> = {}): FindingDraft {
  return {
    field: e.scope === "CURRENT" ? "Weeks_CurrentYear" : "Weeks_PreviousYear",
    yearScope: e.scope,
    params: { 2: e.year, 3: weeks2(e.es) },
    calculated: { expectedService: weeks2(e.es), reportedService: weeks2(e.rs), arielService: weeks2(e.ariel), carveOutDays: e.carveDays, totalDays: e.totalDays, totalYear: e.totalYear, ...extra },
  };
}