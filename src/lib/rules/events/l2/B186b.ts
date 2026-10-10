import { toleranceNumber } from "../../config";
import { SHORTFALL_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import { dec31 } from "../../lib/dates";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B186b_Message / 3466: mid-year-enrolment shortfall (Events minimum = ES - 3.42). */
export const B186b = l2Rule({
  id: "B186b",
  label: "B186b_Message",
  messageId: "3466",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  specNote: "Q10: ValidationYear = EventYear / EventYear-1 (not Year(ExecutionDate)).",
  dataImportMessage: "Total weeks reported for {2} plus weeks previously reported are less than minimum weeks that should be reported.  Please review the member's record for unreported leaves or status changes.         ",
  portalMessage: "Total weeks reported for Reporting Year plus weeks previously reported are less than minimum weeks that should be reported.  Please review the member's record for unreported leaves or status changes.         ",
  evaluate(record, d, ctx) {
    const tol = toleranceNumber(ctx.config, "B186b.weeks", -3.42);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      // Mid-year enrolment shortfall only applies when the event does not end the year early.
      if (d.eventDate < dec31(year)) continue;
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "midYearEnrol", carveTypes: SHORTFALL_CARVE_TYPES, rounding: "DOWN", includeRegul: true });
      if (e && e.rs.lt(e.es.plus(tol))) out.push(serviceDraft(e, { tolerance: tol, minimumService: e.es.plus(tol).toFixed(2) }));
    }
    return out;
  },
});