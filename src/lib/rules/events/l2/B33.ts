import { SCOPES } from "../../lib/context";
import { yearOf } from "../../lib/dates";
import { isPartTimeAnyDay } from "../../lib/breaks";
import type { FindingDraft } from "../../types";
import { l2Rule } from "./_shared";

const LUMP_SUM_ATTRS = new Set(["RCL", "RPREYAD", "RRETRO"]);

/** B33_Message / 5001 (WARNING): lump-sum contributions already exist for a part-time member. CY uses the termination year (section 18 Q7). */
export const B33 = l2Rule({
  id: "B33",
  label: "B33_Message",
  messageId: "5001",
  severity: "WARNING",
  visibility: "PUBLIC",
  tool: "CustomDLL",
  overrideReasons: ["Reported service does not include service for contributory leave."],
  specNote: "Q7: the spec's current-year service clause says 'termination year - 1' (copy-paste); the termination year is used.",
  dataImportMessage: "Lump Sum Contributions for {1} were previously reported for this member. Please verify that this service has been EXCLUDED. Select an override reason to continue.",
  portalMessage: "Lump Sum Contributions were previously reported for this member. Please verify that this service has been EXCLUDED. Select an override reason to continue.",
  evaluate(_record, d) {
    const out: FindingDraft[] = [];
    const emp = d.employment;
    for (const scope of SCOPES) {
      const year = scope === "CURRENT" ? d.eventYear : d.eventYear - 1;
      if (!isPartTimeAnyDay(emp, year)) continue;
      const contrib = emp.contributions.find((c) => c.type === "RPPLOW" && yearOf(c.targetDate) === year);
      const svc = emp.service.find((s) => s.type === "CTSRV" && LUMP_SUM_ATTRS.has(s.summaryAttribute) && yearOf(s.targetDate) === year);
      if (contrib || svc) out.push({ field: scope === "CURRENT" ? "Weeks_CurrentYear" : "Weeks_PreviousYear", yearScope: scope, params: { 1: year }, calculated: { trigger: contrib ? "RPPLOW" : "CTSRV", summaryAttribute: (contrib ?? svc)!.summaryAttribute } });
    }
    return out;
  },
});