import Decimal from "decimal.js";
import { toleranceNumber } from "../../config";
import { B214_CARVE_TYPES, carveOut, NON_CONTRIBUTORY_LEAVE_TYPES } from "../../lib/carve-out";
import { dec, SCOPES, scopePresent } from "../../lib/context";
import { addDays, daysBetween, dec31, endOrOpen, jan1, maxDate, minDate } from "../../lib/dates";
import { isPartTimeAnyDay } from "../../lib/breaks";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

/** B214 / 6012 (WARNING): part-time member with a non-contributory leave; weeks spill into the leave. */
export const B214 = l2Rule({
  id: "B214",
  label: "B214",
  messageId: "6012",
  severity: "WARNING",
  visibility: "PUBLIC",
  overrideReasons: ["Contributory leave data reported.", "Member did not contribute for this leave within the reporting period."],
  dataImportMessage: "This member is part-time with a leave on file for which a contributory leave applies. Please complete the contributory leave information for {1} or select an override reason.",
  portalMessage: "This member is part-time with a leave on file for which a contributory leave applies. Please complete the contributory leave information for this member or select an override reason.",
  evaluate(record, d, ctx) {
    const out: FindingDraft[] = [];
    const tol = toleranceNumber(ctx.config, "B214.weeks", 0.14);
    const minLeaveDays = toleranceNumber(ctx.config, "B214.minLeaveDays", 5);
    const emp = d.employment;
    for (const scope of SCOPES) {
      if (!scopePresent(record, scope)) continue;
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      const weeks = dec(b.weeks);
      if (!weeks) continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      if (!isPartTimeAnyDay(emp, year)) continue;
      const leave = emp.serviceBreaks.find((br) => {
        if (!NON_CONTRIBUTORY_LEAVE_TYPES.has(br.type)) return false;
        const from = maxDate(br.startDate, jan1(year));
        const to = minDate(endOrOpen(br.endDate), jan1(year + 1));
        return daysBetween(from, to) >= minLeaveDays;
      });
      if (!leave) continue;
      const begin = maxDate(jan1(year), emp.permanencyDate);
      const end = scope === "PREVIOUS" ? jan1(year + 1) : record.eventType === "DECFIN" ? d.eventDate : addDays(d.eventDate, 1);
      const span = daysBetween(begin, end);
      if (span <= 0) continue;
      const carve = carveOut(emp.serviceBreaks, { start: begin, endInclusive: addDays(end, -1), clipEnd: end }, B214_CARVE_TYPES);
      const wcp = new Decimal(span - carve.days).div(span).times(52).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      if (weeks.gt(wcp.plus(tol))) {
        out.push({ field: scope === "CURRENT" ? "Weeks_CurrentYear" : "Weeks_PreviousYear", yearScope: scope, params: { 1: year }, calculated: { workingContributoryPeriod: wcp.toFixed(2), reportedWeeks: weeks.toFixed(2), leaveType: leave.type, leaveStart: leave.startDate, carveOutDays: carve.days, spanDays: span, tolerance: tol } });
      }
    }
    void dec31;
    return out;
  },
});