import { defineRule } from "../../types";

/** I50_ValidateFileLayout / 130: data rows carrying more values than the header has names. */
export const I50 = defineRule({
  id: "I50",
  label: "I50_ValidateFileLayout",
  messageId: "130",
  level: "L0",
  severity: "FILE_ERROR",
  visibility: "PUBLIC",
  dataImportMessage: "The imported file contains data that is not associated with a valid column header.",
  portalMessage: "The imported file contains data that is not associated with a valid column header.",
  evaluate(_record, ctx) {
    const offending = ctx.file.rows.filter((r) => r.extraValues.length > 0);
    if (offending.length === 0) return [];
    return [
      {
        params: {},
        calculated: {
          firstOffendingLine: offending[0].lineNumber,
          offendingRows: offending.length,
          headerWidth: ctx.file.header.length,
        },
      },
    ];
  },
});
