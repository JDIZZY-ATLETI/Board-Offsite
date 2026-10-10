import Decimal from "decimal.js";
import { toleranceNumber } from "../../config";
import { calculateAE, calculatedPA } from "../../lib/ae";
import { dec, SCOPES } from "../../lib/context";
import { addYears, daysBetween, endOrOpen, jan1, maxDate, minDate, yearOf } from "../../lib/dates";
import { whole } from "../../lib/format";
import { arielService, sum, txView, type TxView } from "../../lib/service";
import { ltdBreakIn } from "../../lib/breaks";
import type { ArielEmployment, ArielMemberSnapshot, ArielRateTables } from "@/types";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

type Situation = 1 | 2 | 3;

function freeAccrualService(member: ArielMemberSnapshot, emp: ArielEmployment, ltdStart: string, ltdEnd: string, year: number, view: TxView): { fa: Decimal; source: string } {
  if (year < 2017) {
    const fasrv = sum(emp.service.filter((s) => s.type === "FASRV" && yearOf(s.targetDate) === year).map((s) => s.amount));
    return { fa: fasrv, source: "FASRV" };
  }
  // Section 18 Q22: the ACW factor is read from a stored ACW service transaction (same start date as the break when available).
  const acwRows = emp.service.filter((s) => s.type === "ACW");
  const acw = acwRows.find((s) => s.beginDate === ltdStart) ?? acwRows[0];
  if (!acw) return { fa: new Decimal(0), source: "ACW_MISSING" };
  const capDate = minDate(endOrOpen(emp.terminationDate), addYears(member.dateOfBirth, 65), jan1(year + 1));
  const from = maxDate(ltdStart as never, jan1(year));
  const to = minDate(ltdEnd as never, capDate);
  const days = Math.max(0, daysBetween(from, to));
  const contributory = sum(view.service.filter((s) => s.type === "CTSRV").map((s) => s.amount)).div(52);
  const priorFa = sum(emp.service.filter((s) => s.type === "FASRV" && yearOf(s.targetDate) < year).map((s) => s.amount));
  const cap = Decimal.max(0, new Decimal(35).minus(contributory).minus(priorFa));
  return { fa: Decimal.min(new Decimal(acw.amount).times(days), cap), source: "stored" };
}

function situationOf(ltdStart: string, ltdEnd: string, year: number, hasFaRate: boolean): Situation {
  const y1 = jan1(year);
  const next = jan1(year + 1);
  const startsInYearNotJan1 = ltdStart > y1 && ltdStart < next;
  const endsAfterYear = ltdEnd >= next;
  if (!endsAfterYear) return 3;
  if (ltdStart <= y1) return 2;
  if (startsInYearNotJan1 && hasFaRate) return 2;
  return 1;
}

function aeContributions(view: TxView, year: number, permYear: number, rates: ArielRateTables): Decimal {
  for (let y = year; y >= permYear; y--) {
    const ae = calculateAE(view, y, rates, "retroPaid").ae;
    if (ae.gt(0)) return ae;
  }
  return new Decimal(0);
}

/** B53b / 7375 (Events) · 8795 (Events_LTD): LTD member's PA must equal the calculated PA (tolerance 0). */
export const B53b = l2Rule({
  id: "B53b",
  label: "B53b_ReportedPAAmendedPANotWithinAcceptableToleranceCalculatedPALTD",
  messageId: (draft) => (draft.calculated?.situation === 1 ? "7375" : "8795"),
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  specNote: "Q8: 8795 when FA/ACW inputs are used (situations 2-3), 7375 otherwise. Q22: ACW factor read from a stored ACW transaction.",
  dataImportMessage: "The {2} for {3} with disability service is incorrect based on the data provided. The HOOPP calculated value is {4}.",
  portalMessage: "Reported PA with disability service not in line.",
  evaluate(record, d, ctx) {
    const out: FindingDraft[] = [];
    const tol = toleranceNumber(ctx.config, "B53b.pa", 0);
    const view = txView(d.employment, d);
    const emp = d.employment;
    const permYear = yearOf(emp.permanencyDate);
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      if (typeof b.pa !== "number") continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      const ltd = ltdBreakIn(emp, year).sort((a, c) => a.startDate.localeCompare(c.startDate))[0];
      if (!ltd) continue;
      const ltdEnd = endOrOpen(ltd.endDate);
      const faRate = emp.salaryRates.find((s) => s.type === "FARATE" && yearOf(s.effectiveDate) === year);
      const situation = situationOf(ltd.startDate, ltdEnd, year, Boolean(faRate));
      const weeksFile = dec(b.weeks) ?? new Decimal(0);
      let cs = weeksFile.plus(arielService(view, year)).div(52);
      const { fa, source } = situation === 1 ? { fa: new Decimal(0), source: "n/a" } : freeAccrualService(d.member, emp, ltd.startDate, ltdEnd, year, view);
      let ae: Decimal;
      if (situation === 1) {
        ae = aeContributions(view, year, permYear, ctx.rates);
      } else if (situation === 2) {
        cs = new Decimal(0);
        ae = faRate ? new Decimal(faRate.rate) : new Decimal(0);
      } else {
        const contrib = aeContributions(view, year, permYear, ctx.rates);
        const total = cs.plus(fa);
        const blended = total.isZero() ? new Decimal(0) : contrib.times(cs.div(total)).plus((faRate ? new Decimal(faRate.rate) : new Decimal(0)).times(fa.div(total)));
        ae = Decimal.max(contrib, blended);
      }
      const svc = cs.plus(fa);
      const calc = calculatedPA(ae, svc, year, ctx.rates);
      const diff = new Decimal(whole(calc)).minus(b.pa).abs();
      if (diff.gt(tol)) {
        out.push({
          field: scope === "CURRENT" ? "PA_CurrentYear" : "PA_PreviousYear",
          yearScope: scope,
          params: { 2: "PA", 3: year, 4: whole(calc) },
          calculated: { situation, calculatedPA: calc.toFixed(2), reportedPA: b.pa, annualizedEarnings: ae.toFixed(2), contributoryService: cs.toFixed(4), freeAccrualService: fa.toFixed(4), acwSource: source, ltdStart: ltd.startDate, ltdEnd: ltd.endDate ?? "open" },
        });
      }
    }
    return out;
  },
});