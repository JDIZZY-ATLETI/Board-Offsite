import type { BatchStatus, Role } from "@/types";

export interface NextStepCopy {
  text: string;
  /** Optional CTA label + href resolved by the caller. */
  cta?: { label: string; target: "findings-held" | "update-set" | "reports" | "upload" };
}

/** docs/ux-design.md section 7.6 "Next step" copy by status, verbatim. */
export function nextStepCopy(status: BatchStatus, role: Role, ctx: { heldCount: number; reason?: string; failureReason?: string; exportedOn?: string }): NextStepCopy {
  const submitter = role === "EmployerSubmitter";
  const n = ctx.heldCount;
  switch (status) {
    case "RECEIVED":
    case "PARSED":
      return submitter ? { text: "We're checking the file. This usually takes under a minute." } : { text: "Parsing…" };
    case "VALIDATED":
      if (n > 0) {
        return submitter
          ? { text: `${n} warning${n === 1 ? "" : "s"} need a HOOPP reviewer's override before this batch can continue. No action needed from you unless values are wrong.` }
          : { text: `${n} held row${n === 1 ? "" : "s"} need an override`, cta: { label: "Open held rows", target: "findings-held" } };
      }
      return submitter ? { text: "Validation complete. Writing results…" } : { text: "Ledgering…" };
    case "LEDGERED":
    case "PROJECTION_BUILT":
      return submitter ? { text: "Validation complete. Writing results…" } : { text: "Ledgering…" };
    case "PENDING_APPROVAL":
      return submitter ? { text: "Validation complete. HOOPP is reviewing the pension-record changes." } : { text: "Review and approve the Update Set", cta: { label: "Review Update Set", target: "update-set" } };
    case "APPROVED":
      return submitter ? { text: "Approved by HOOPP. Export to pension records is in progress." } : { text: "Export the Update Set", cta: { label: "Export", target: "update-set" } };
    case "EXPORTED":
      return submitter ? { text: `Done. Changes were exported on ${ctx.exportedOn ?? "the recorded date"}.` } : { text: "Exported", cta: { label: "View files", target: "reports" } };
    case "REJECTED":
      return submitter ? { text: `HOOPP rejected this batch: "${ctx.reason ?? ""}". Correct the file if asked and upload again.` } : { text: `Rejected: "${ctx.reason ?? ""}" · Admin can reopen` };
    case "FILE_REJECTED":
      return submitter ? { text: "The file couldn't be read. Fix the header/rows noted below and upload again.", cta: { label: "Upload again", target: "upload" } } : { text: "File rejected (I50/I51)" };
    case "FAILED":
      return submitter ? { text: "Processing hit a problem on our side. HOOPP has been notified." } : { text: `Failed: ${ctx.failureReason ?? "unknown error"}` };
  }
}