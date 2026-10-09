import { analyseHeader } from "@/lib/events/parse";
import { defineRule } from "../../types";

/**
 * I51_ValidateFileHeaderLayout / 4887: any header label outside the layout, a duplicated label, or an
 * empty file rejects the whole file (architecture section 18 Q2). Missing columns are allowed.
 * A file whose bytes cannot be an ANSI/UTF-8 CSV (UTF-16, NUL bytes) has no readable header and is
 * rejected here with `reason=UNSUPPORTED_ENCODING` - the spec has no dedicated encoding rule (QA BUG-PIPE-1).
 */
export const I51 = defineRule({
  id: "I51",
  label: "I51_ValidateFileHeaderLayout",
  messageId: "4887",
  level: "L0",
  severity: "FILE_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "The imported file contains invalid column headers.",
  portalMessage: "The imported file contains invalid column headers.",
  evaluate(_record, ctx) {
    if (ctx.file.encodingProblem) return [{ params: {}, calculated: { reason: "UNSUPPORTED_ENCODING", detected: ctx.file.encodingProblem } }];
    const h = analyseHeader(ctx.file.header);
    if (h.empty) return [{ params: {}, calculated: { reason: "EMPTY_FILE" } }];
    if (h.unknown.length > 0) {
      return [{ params: {}, calculated: { reason: "INVALID_HEADER", invalidLabels: h.unknown.join("|") } }];
    }
    if (h.duplicates.length > 0) {
      return [{ params: {}, calculated: { reason: "DUPLICATE_HEADER", duplicateLabels: h.duplicates.join("|") } }];
    }
    return [];
  },
});
