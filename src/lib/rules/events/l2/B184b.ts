import { toleranceNumber } from "../../config";
import { EXCESS_CARVE_TYPES } from "../../lib/carve-out";
import { SCOPES } from "../../lib/context";
import type { FindingDraft } from "../../types";
import { evaluateServiceWindow, serviceDraft } from "./_service-rules";
import { l2Rule } from "./_shared";

/** B184b_ExcessServiceEnrolledMidYear / 3002. */
export const B184b = l2Rule({
  id: "B184b",
  label: "B184b_ExcessServiceEnrolledMidYear",
  messageId: "3002",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  dataImportMessage: "In-year enrolment: Total Weeks reported for {2} plus weeks previously reported exceed the {3} maximum possible weeks.         ",
  portalMessage: "In-year enrolment: Total Weeks reported for the reporting year plus weeks previously reported exceed the maximum possible weeks.",
  evaluate(record, d, ctx) {
    const tol = toleranceNumber(ctx.config, "B184b.weeks", 0);
    const out: FindingDraft[] = [];
    for (const scope of SCOPES) {
      const e = evaluateServiceWindow(record, d, ctx, scope, { kind: "midYearEnrol", carveTypes: EXCESS_CARVE_TYPES, rounding: "UP", includeRegul: false });
      if (e && e.rs.gt(e.es.plus(tol))) out.push(serviceDraft(e, { tolerance: tol }));
    }
    return out;
  },
});