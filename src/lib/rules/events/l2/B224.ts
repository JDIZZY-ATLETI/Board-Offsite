import { endOrOpen } from "../../lib/dates";
import { l2Rule } from "./_shared";

/** B224_ / 3001: concurrent active employments at the same employer overlapping in time. */
export const B224 = l2Rule({
  id: "B224",
  label: "B224_",
  messageId: "3001",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  tool: "StandardValidationModule",
  dataImportMessage: "Member is already enrolled with HOOPP at your organization.",
  portalMessage: "Member is already enrolled with HOOPP at your organization.",
  evaluate(_record, d, ctx) {
    const emps = d.member.employments.filter((e) => e.employerId === ctx.batch.employerId);
    for (let i = 0; i < emps.length; i++) {
      for (let j = i + 1; j < emps.length; j++) {
        const a = emps[i];
        const b = emps[j];
        const overlap = a.permanencyDate <= endOrOpen(b.terminationDate) && b.permanencyDate <= endOrOpen(a.terminationDate);
        const bothActive = a.terminationDate === null && b.terminationDate === null;
        if (overlap && bothActive) return [{ params: {}, calculated: { employments: `${a.employmentId},${b.employmentId}` } }];
      }
    }
    return [];
  },
});