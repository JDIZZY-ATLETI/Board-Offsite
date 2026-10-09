import { fillTemplate } from "@/lib/ui/format";
import type { ValidationFinding } from "@/types";

/**
 * UI-only "What to do" hints (docs/ux-design.md section 7.2, decision D2). The spec's Portal message is
 * rendered verbatim elsewhere; these templates are additive guidance owned by HOOPP.
 * Placeholders are filled from the finding (field, yearScope, params, calculated).
 */
export const FINDING_HINTS: Readonly<Record<string, string>> = {
  I1: "Fill in `{field}` for this row. It is required for every row (or for {eventType} rows).",
  I2: "Enter the member's SIN. Every row needs a SIN so HOOPP can match the member.",
  I3: "Shorten the value in `{field}` to at most {maxLength} characters (including the decimal point).",
  I5: "Enter the date as MMDDYYYY, e.g. 09302026 for 2026-09-30. You entered `{raw}`.",
  I7: "Use at most two decimal places and a period as the decimal symbol, e.g. 523.64.",
  I8: "Enter a whole number without decimals or signs, e.g. 12594.",
  I9: "Use one of TERFIN, RETFIN or DECFIN in `EventType`. You entered `{raw}`.",
  I10: "This SIN appears on {n} rows. Keep one correct row and remove the others.",
  I32: "Report either weeks or annualized earnings for {year}, not both.",
  I55: "Weeks were reported for {year} but Low Contributions is 0. Add the contributions or set weeks to 0.",
  B2: "We can't find this SIN at your organization. Check the SIN; if the person is new, complete an Enrolment first.",
  B5: "HOOPP's records show this member's employment is already closed. Remove the row or contact HOOPP.",
  B37: "Low Contributions for {year} can't exceed {max} for {weeks} weeks. Check the amount.",
  B184a: "Reduce `Weeks_{scope}` so that file weeks + weeks already reported ({ariel}) is at most {max}.",
  B184b: "Reduce `Weeks_{scope}` so that file weeks + weeks already reported ({ariel}) is at most {max}.",
  B184c: "Reduce `Weeks_{scope}` so that file weeks + weeks already reported ({ariel}) is at most {max}.",
  B185: "Weeks for {year} look too low. Check for unreported leaves; HOOPP expects at least {min}.",
  B186: "Weeks for {year} look too low. Check for unreported leaves; HOOPP expects at least {min}.",
  B186a: "Weeks for {year} look too low. Check for unreported leaves; HOOPP expects at least {min}.",
  B186b: "Weeks for {year} look too low. Check for unreported leaves; HOOPP expects at least {min}.",
  B187: "Negative values are not allowed in `{field}`. Enter 0 or a positive amount. You entered `{raw}`.",
  B192a: "{year} data was already received through MDC. Clear the {scope} columns for this row.",
  B192b: "HOOPP never received {year} data for this member. Fill in the previous-year columns (use 0 if there were none).",
  B40: WARNING_HINT(),
  B43: WARNING_HINT(),
  B47: WARNING_HINT(),
  B38: WARNING_HINT(),
  B33: WARNING_HINT(),
  B214: WARNING_HINT(),
  B139: WARNING_HINT(),
  B31: WARNING_HINT(),
  I42: "The event date is after today ({execDate}). Check the year.",
  I50: "A row has more values than the header has columns — usually a stray comma. Check row {line}.",
  I51: "The header doesn't match the Events layout. Unknown: {headers}. Download the template and copy your data in.",
};

function WARNING_HINT(): string {
  return "No file change required if the value is correct — a HOOPP reviewer will choose an override reason. If it's wrong, correct it and re-upload.";
}

/** Rule ids are sometimes suffixed (`B187_WeeksCurrentYear`); hints key on the base id. */
export function hintKeyFor(ruleId: string): string | null {
  if (FINDING_HINTS[ruleId]) return ruleId;
  const base = ruleId.split("_")[0];
  return FINDING_HINTS[base] ? base : null;
}

function yearLabel(scope: ValidationFinding["yearScope"]): string {
  return scope === "PREVIOUS" ? "the previous year" : "the current year";
}

/** Returns the filled hint, or null when no hint exists (callers fall back to the Portal message). */
export function hintFor(finding: Pick<ValidationFinding, "ruleId" | "field" | "yearScope" | "params" | "calculated">): string | null {
  const key = hintKeyFor(finding.ruleId);
  if (!key) return null;
  const p = finding.params ?? {};
  const c = finding.calculated ?? {};
  if (key === "I51" && c.reason === "EMPTY_FILE") return "The file is empty. Export the Events file again and upload it.";
  const raw = p["1"] ?? p["0"] ?? p.raw;
  const values: Record<string, string | number | boolean | null | undefined> = {
    field: finding.field ?? "this field",
    raw: raw === undefined ? undefined : String(raw),
    eventType: "TERFIN/RETFIN/DECFIN",
    maxLength: p["Max Length"],
    n: c.occurrences as number | undefined,
    year: yearLabel(finding.yearScope),
    scope: finding.yearScope === "PREVIOUS" ? "PreviousYear" : "CurrentYear",
    execDate: c.executionDate as string | undefined,
    line: p.line ?? (c.lineNumber as number | undefined),
    headers: (c.invalidLabels as string | undefined)?.split("|").join(", ") ?? (c.duplicateLabels as string | undefined)?.split("|").join(", ") ?? "(see technical detail)",
    max: p.max ?? (c.max as string | undefined),
    min: p.min ?? (c.min as string | undefined),
    weeks: p.weeks ?? (c.weeks as string | undefined),
    ariel: p.ariel ?? (c.ariel as string | undefined),
  };
  return fillTemplate(FINDING_HINTS[key], values);
}