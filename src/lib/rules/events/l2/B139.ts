import { messageDate } from "../../lib/dates";
import { l2Rule } from "./_shared";

/** B139_EmploymentEndDateSameAsInitiallyReported / 2492 (WARNING). Section 8.6 adds a calculation indicator on override. */
export const B139 = l2Rule({
  id: "B139",
  label: "B139_EmploymentEndDateSameAsInitiallyReported",
  messageId: "2492",
  severity: "WARNING",
  visibility: "PUBLIC",
  overrideReasons: ["Yes, Employment End Date has changed from originally reported value."],
  specNote: "Q13: on override the derivation creates calculation indicator CHG_RET_EED (Phase 3).",
  dataImportMessage: "The Employment End Date for this retirement was previously reported as {0}.  If the Employment End Date has changed, please provide an override reason.",
  portalMessage: "The Employment End Date provided for this retirement is different than was previously reported.  ",
  appliesTo: (record) => record.eventType === "RETFIN" && typeof record.employmentEndDate === "string",
  evaluate(record, d) {
    const emp = d.employment;
    if (emp.terminationCode !== "RET" || !emp.terminationDate || !record.employmentEndDate) return [];
    if (record.employmentEndDate === emp.terminationDate) return [];
    return [{ field: "EmploymentEndDate", params: { 0: messageDate(emp.terminationDate) }, calculated: { previousTerminationDate: emp.terminationDate, employmentEndDate: record.employmentEndDate } }];
  },
});