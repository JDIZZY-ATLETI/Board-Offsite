import { toleranceNumber } from "../../config";
import { EXCESS_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import { weeks2 } from "../../lib/format";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B184a_ExcessServiceEnrolledFullYear / 66. */
export const B184a = l2Rule({
  id: "B184a",
  label: "B184a_ExcessServiceEnrolledFullYear",
  messageId: "66",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "Active full year: Total Weeks reported for {2} plus weeks previously reported exceed the {3} maximum possible weeks.         ",
  portalMessage: "Active full year: Total Weeks reported for the reporting year plus weeks previously reported exceed the maximum possible weeks.         ",
  evaluate(record, d, ctx) {
    const tol = toleranceNumber(ctx.config, "B184a.weeks", 0);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "fullYear", carveTypes: EXCESS_CARVE_TYPES, rounding: "UP", includeRegul: false });
      if (e && e.rs.gt(e.es.plus(tol))) out.push(serviceDraft(e, { tolerance: tol, suggestedWeeks: weeks2(e.es.minus(e.ariel)) }));
    }
    return out;
  },
});