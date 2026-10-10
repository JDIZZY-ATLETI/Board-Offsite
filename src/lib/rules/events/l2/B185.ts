import { toleranceNumber } from "../../config";
import { SHORTFALL_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import { weeks2 } from "../../lib/format";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B185_Message / 3506: shortfall within one week of the full-year expectation must be rolled up. */
export const B185 = l2Rule({
  id: "B185",
  label: "B185_Message",
  messageId: "3506",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "The Weeks reported for {2} should be adjusted to {3}. Contributions may not need to be adjusted if reported correctly.  ",
  portalMessage: "The Weeks reported for Reporting Year should be adjusted to Minimum Possible Service. Contributions may not need to be adjusted if reported correctly.  ",
  evaluate(record, d, ctx) {
    const tol = toleranceNumber(ctx.config, "B185.weeks", -1);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "fullYear", carveTypes: SHORTFALL_CARVE_TYPES, rounding: "DOWN", includeRegul: true, strictPermanency: true });
      if (e && e.rs.lt(e.es) && e.rs.gte(e.es.plus(tol))) out.push(serviceDraft(e, { tolerance: tol, suggestedWeeks: weeks2(e.es.minus(e.ariel)) }));
    }
    return out;
  },
});