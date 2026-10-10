import { toleranceNumber } from "../../config";
import { EXCESS_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B184c_Excess ServiceTerminatedMidYear / 7854 (Events only; tolerance +3 weeks). */
export const B184c = l2Rule({
  id: "B184c",
  label: "B184c_Excess ServiceTerminatedMidYear",
  messageId: "7854",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  specNote: "Q25: breaks are carved within [Jan 1, EventDate] rather than the spec's year-end clip, which would over-carve a break running past the termination.",
  dataImportMessage: "In-year termination: Total Weeks reported for {2} plus weeks previously reported exceed the {3} maximum possible weeks.         ",
  portalMessage: "In-year termination: Total Weeks reported for the reporting year plus weeks previously reported exceed the maximum possible weeks.       ",
  evaluate(record, d, ctx) {
    const tol = toleranceNumber(ctx.config, "B184c.weeks", 3);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "midYearTerm", carveTypes: EXCESS_CARVE_TYPES, rounding: "UP", includeRegul: false });
      if (e && e.rs.gt(e.es.plus(tol))) out.push(serviceDraft(e, { tolerance: tol }));
    }
    return out;
  },
});