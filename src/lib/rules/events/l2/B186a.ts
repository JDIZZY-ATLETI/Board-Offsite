import { toleranceNumber } from "../../config";
import { SHORTFALL_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B186a_Message / 573: full-year shortfall beyond tolerance (Events minimum = ES - 1). Section 18 Q10 for the year. */
export const B186a = l2Rule({
  id: "B186a",
  label: "B186a_Message",
  messageId: "573",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  specNote: "Q10: ValidationYear = EventYear / EventYear-1 (not Year(ExecutionDate)).",
  dataImportMessage: "Total weeks reported for {2} plus weeks previously reported are less than minimum weeks that should be reported. Please review the member's record for unreported leaves or status changes.",
  portalMessage: "Total weeks reported for Reporting Year plus weeks previously reported are less than minimum weeks that should be reported. Please review the member's record for unreported leaves or status changes.",
  evaluate(record, d, ctx) {
    const tol = toleranceNumber(ctx.config, "B186a.weeks", -1);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "fullYear", carveTypes: SHORTFALL_CARVE_TYPES, rounding: "DOWN", includeRegul: true });
      if (e && e.rs.lt(e.es.plus(tol))) out.push(serviceDraft(e, { tolerance: tol, minimumService: e.es.plus(tol).toFixed(2) }));
    }
    return out;
  },
});