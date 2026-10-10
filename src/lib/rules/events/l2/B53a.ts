import Decimal from "decimal.js";
import { toleranceNumber } from "../../config";
import { calculateAE, calculatedPA } from "../../lib/ae";
import { dec, isZero, SCOPES, zeroOrBlank } from "../../lib/context";
import { whole } from "../../lib/format";
import { arielService, txView } from "../../lib/service";
import { ltdBreakIn } from "../../lib/breaks";
import type { FindingDraft } from "../../types";
import { l2Rule, rateGap, skipRule } from "./_shared";

/** B53a / 2160 (Events): non-LTD member's PA must be within +/-250 of the HOOPP-calculated PA. */
export const B53a = l2Rule({
  id: "B53a",
  label: "B53a_ReportedPAAmendedPANotWithinAcceptableToleranceCalculatedPANonLTD",
  messageId: "2160",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "The {2} for {3} is incorrect based on the data provided. The HOOPP calculated value is {4}.",
  portalMessage: "Reported PA not in line.",
  evaluate(record, d, ctx) {
    const out: FindingDraft[] = [];
    const tol = toleranceNumber(ctx.config, "B53a.pa", 250);
    const view = txView(d.employment, d);
    for (const scope of SCOPES) {
      const b = scope === "CURRENT" ? record.currentYear : record.previousYear;
      if (typeof b.pa !== "number") continue;
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      if (ltdBreakIn(d.employment, year).length > 0) continue;
      const weeksFile = dec(b.weeks) ?? new Decimal(0);
      if (b.pa === 0 && weeksFile.isZero() && zeroOrBlank(b.lowContributions) && zeroOrBlank(b.highContributions)) continue;
      const svc = weeksFile.plus(arielService(view, year)).div(52);
      const aeResult = calculateAE(view, year, ctx.rates, "retroPaid");
      const calc = aeResult && calculatedPA(aeResult.ae, svc, year, ctx.rates);
      if (!aeResult || !calc) {
        skipRule(ctx, "B53a", record, rateGap(ctx, year) ?? `RATE_MISSING:MGA:${year}`);
        continue;
      }
      const ae = aeResult.ae;
      const diff = calc.minus(b.pa);
      if (diff.lte(-tol) || diff.gte(tol)) {
        out.push({
          field: scope === "CURRENT" ? "PA_CurrentYear" : "PA_PreviousYear",
          yearScope: scope,
          params: { 2: "PA", 3: year, 4: whole(calc) },
          calculated: { calculatedPA: calc.toFixed(2), reportedPA: b.pa, annualizedEarnings: ae.toFixed(2), service: svc.toFixed(4), tolerance: tol },
        });
      }
    }
    void isZero;
    return out;
  },
});