import { toleranceString } from "../../config";
import { isZero } from "../../lib/context";
import { dec31, yearOf } from "../../lib/dates";
import type { IsoDate } from "@/types";
import { l2Rule } from "./_shared";

/** B31 / 7309: enrolled in the last pay period, zero weeks. Spec CME with an override reason -> WARNING (section 18 Q6). */
export const B31 = l2Rule({
  id: "B31",
  label: "B31",
  messageId: "7309",
  severity: "WARNING",
  visibility: "PUBLIC",
  overrideReasons: ["The member enrolled in the last pay period of the reporting year and contributions will be reported in the next MDC reporting period."],
  specNote: "Q6: spec severity is Complete Member Error but the message asks for an override reason; implemented as WARNING requiring override.",
  dataImportMessage: "Zero weeks have been reported for this member.  Please revise member data, or select a valid override reason to continue.  If more information is required please contact HOOPP.",
  portalMessage: "Zero weeks have been reported for this member.  Please revise member data, or select a valid override reason to continue.  If more information is required please contact HOOPP.",
  evaluate(record, d, ctx) {
    if (!isZero(record.currentYear.weeks)) return [];
    const execYear = yearOf(ctx.batch.executionDate);
    const windowStart = `${execYear}-${toleranceString(ctx.config, "B31.windowStart", "12-08")}` as IsoDate;
    const p = d.employment.permanencyDate;
    if (p >= windowStart && p <= dec31(execYear)) return [{ field: "Weeks_CurrentYear", yearScope: "CURRENT", params: {}, calculated: { permanencyDate: p, windowStart } }];
    return [];
  },
});