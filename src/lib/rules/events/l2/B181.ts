import { retroPaidDraft } from "./_retro";
import { l2Rule } from "./_shared";

/** B181_RetroPaid / 6700 - disabled by default since R14 (section 18 Q21); toggle via config `enabled.B181`. */
export const B181 = l2Rule({
  id: "B181",
  label: "B181_RetroPaid",
  messageId: "6700",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  enabledByDefault: false,
  specNote: "Q21: disabled by HOOPP as of R14; shipped disabled.",
  dataImportMessage: "Retro Contributions have been previously reported as paid in {0} and no service or contributions have been reported for {0}.  Please report a PA of 0.00 and HOOPP will contact you with the corrected PA for {0}.  ",
  portalMessage: "Retro Contributions have been previously reported as paid in Reporting Year and no service or contributions have been reported for Reporting Year.  Please report a PA of 0.00 and HOOPP will contact you with the corrected PA for Reporting Year.  ",
  evaluate: (record, d) => retroPaidDraft(record, d),
});