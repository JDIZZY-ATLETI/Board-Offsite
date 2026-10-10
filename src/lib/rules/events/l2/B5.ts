import { yearOf } from "../../lib/dates";
import { l2Rule } from "./_shared";

/**
 * B5_MemberNotEligibleForThisDataUpdate / 5728 (Final Data - Events variants, R14). Only the reporting
 * employer's most recent employment is considered (concurrent members: spec "HOOPP Additional Info").
 */
export const B5 = l2Rule({
  id: "B5",
  label: "B5_MemberNotEligibleForThisDataUpdate",
  messageId: "5728",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "This member is not eligible for this type of data collection/revision.",
  portalMessage: "This member is not eligible for this type of data collection/revision.",
  evaluate(record, d) {
    const emp = d.employment;
    const calc = { terminationCode: emp.terminationCode ?? "", terminationDate: emp.terminationDate ?? "" };
    if (record.eventType === "TERFIN") {
      return emp.terminationDate !== null ? [{ field: "EventType", params: {}, calculated: { ...calc, reason: "ALREADY_TERMINATED" } }] : [];
    }
    // RETFIN and DECFIN share the retirement variant.
    if (emp.terminationCode === "TER" || emp.terminationCode === "DEC" || emp.terminationCode === "AMA") {
      return [{ field: "EventType", params: {}, calculated: { ...calc, reason: `TERMINATION_CODE_${emp.terminationCode}` } }];
    }
    if (emp.terminationCode === "RET" && record.employmentEndDate) {
      const y = yearOf(record.employmentEndDate);
      const ctsrv = emp.service.find((s) => s.type === "CTSRV" && yearOf(s.targetDate) === y);
      if (ctsrv) return [{ field: "EventType", params: {}, calculated: { ...calc, reason: "RET_WITH_CTSRV_IN_YEAR", year: y } }];
    }
    return [];
  },
});