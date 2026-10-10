import { toleranceNumber } from "../../config";
import { SHORTFALL_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B186c_Shortfall / 9829: mid-year-termination shortfall (RS < 0.65 x ES). */
export const B186c = l2Rule({
  id: "B186c",
  label: "B186c_Shortfall",
  messageId: "9829",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  specNote: "Q10: ValidationYear = EventYear / EventYear-1 (not Year(ExecutionDate)).",
  dataImportMessage: "Total weeks reported for {2} plus weeks previously reported are less than minimum weeks that should be reported.  Please review the member's record for unreported leaves or status changes.         ",
  portalMessage: "Total weeks reported for Reporting Year plus weeks previously reported are less than minimum weeks that should be reported.  Please review the member's record for unreported leaves or status changes.         ",
  evaluate(record, d, ctx) {
    const factor = toleranceNumber(ctx.config, "B186c.factor", 0.65);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "midYearTerm", carveTypes: SHORTFALL_CARVE_TYPES, rounding: "DOWN", includeRegul: true });
      if (e && e.rs.lt(e.es.times(factor))) out.push(serviceDraft(e, { factor, minimumService: e.es.times(factor).toFixed(2) }));
    }
    return out;
  },
});