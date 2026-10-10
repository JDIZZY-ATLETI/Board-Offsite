import { retroPaidDraft } from "./_retro";
import { l2Rule } from "./_shared";

/** B182_RetroPaid / 9810 (INFORMATION, PRIVATE): same condition as B181, always enabled. */
export const B182 = l2Rule({
  id: "B182",
  label: "B182_RetroPaid",
  messageId: "9810",
  severity: "INFORMATION",
  visibility: "PRIVATE",
  dataImportMessage: "Retro Contributions have been previously reported as paid in {0} and no service or contributions have been reported for {0}.  Please report a PA of 0.00 and HOOPP will contact you with the corrected PA for {0}.  ",
  portalMessage: "Retro Contributions have been previously reported as paid in Reporting Year and no service or contributions have been reported for Reporting Year.  Please report a PA of 0.00 and HOOPP will contact you with the corrected PA for Reporting Year.  ",
  evaluate: (record, d) => retroPaidDraft(record, d),
});