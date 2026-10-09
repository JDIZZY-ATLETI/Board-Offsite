import { describe, expect, it } from "vitest";
import { I1 } from "@/lib/rules/events/l1/I1";
import { I2 } from "@/lib/rules/events/l1/I2";
import { I3 } from "@/lib/rules/events/l1/I3";
import { I5 } from "@/lib/rules/events/l1/I5";
import { I7 } from "@/lib/rules/events/l1/I7";
import { I8 } from "@/lib/rules/events/l1/I8";
import { I9 } from "@/lib/rules/events/l1/I9";
import { I10 } from "@/lib/rules/events/l1/I10";
import { I32 } from "@/lib/rules/events/l1/I32";
import { I55 } from "@/lib/rules/events/l1/I55";
import { B187_RULES } from "@/lib/rules/events/l1/B187";
import { I42 } from "@/lib/rules/events/l2/I42";
import { I50 } from "@/lib/rules/events/l0/I50";
import { I51 } from "@/lib/rules/events/l0/I51";
import { runFileRules, runRecordRules, type EngineDeps } from "@/lib/rules/engine";
import { hasUnresolvedPlaceholders, renderMessage } from "@/lib/rules/render";
import { parseEventsCsv } from "@/lib/events/parse";
import { buildRecord } from "@/lib/events/record";
import { MAX_LENGTHS, type EventsCsvColumn, type RawValues } from "@/types";
import { ctxOf, rec, ruleHarness } from "../helpers/rule-harness";
import { VALID_TERFIN } from "../helpers/fixtures";

/**
 * QA rule-conformance boundary probes (docs/architecture.md section 7.9.1-7.9.2 vs docs/reference/hoopp-ch7-validations-v15.1.txt).
 * Each block targets a boundary the base rule specs do not pin down.
 */

const KEY = Buffer.from("a1".repeat(32), "hex");
const deps: EngineDeps = { newId: () => "f", now: () => new Date("2026-10-08T12:00:00.000Z") };

/** Runs L1 (+ Ariel-free L2) for a single-row file built from the raw cells. */
function engineFindings(over: Partial<RawValues>, extra: Partial<Parameters<typeof ctxOf>[0]> = {}) {
  const r = rec(over);
  return runRecordRules(r, ctxOf({ records: [r], ...extra }), deps);
}

describe("QA/rules: I3 max length boundaries (9519)", () => {
  const h = ruleHarness(I3);
  const cols = Object.keys(MAX_LENGTHS) as EventsCsvColumn[];
  it.each(cols)("%s: exactly max length passes, max+1 fires (length includes the decimal point)", (col) => {
    const max = MAX_LENGTHS[col] as number;
    const isInt = col.startsWith("AnnualizedEarnings") || col.startsWith("PA_");
    const atMax = isInt ? "9".repeat(max) : "9".repeat(max - 3) + ".99";
    const over = atMax + "9";
    expect(atMax.length).toBe(max);
    h.given(rec({ [col]: atMax } as Partial<RawValues>)).expectNoFinding();
    h.given(rec({ [col]: over } as Partial<RawValues>)).expectFinding({ field: col, messageId: "9519", params: { "File.FieldName": col, "Max Length": max }, dataImportMessage: `The field ${col} exceeds the maximum acceptable length of ${max} characters (including decimal point, if applicable).` });
  });
  it("surrounding whitespace is not counted toward the length", () => {
    h.given(rec({ Weeks_CurrentYear: "  52.00  " })).expectNoFinding();
  });
  it("a minus sign counts as a character (spec: Length(file.X))", () => {
    h.given(rec({ Weeks_CurrentYear: "-52.0" })).expectNoFinding();
    h.given(rec({ Weeks_CurrentYear: "-52.00" })).expectFinding({ field: "Weeks_CurrentYear" });
  });
  it("names are NOT length-checked for Events (spec note: Enrolments/MBI only)", () => {
    h.given(rec({ LastName: "X".repeat(200), FirstName: "Y".repeat(200) })).expectNoFinding();
  });
});

describe("QA/rules: I5 date boundaries (825)", () => {
  const h = ruleHarness(I5);
  it.each([
    ["02302026", "Feb 30"],
    ["13012026", "month 13"],
    ["00312026", "month 00"],
    ["01002026", "day 00"],
    ["04312026", "Apr 31"],
    ["02292023", "non-leap Feb 29"],
    ["02292100", "century non-leap Feb 29"],
    ["01011899", "year < 1900"],
    ["01013000", "year > 2999"],
    ["2026-09-30", "ISO"],
    ["09/30/2026", "slashes"],
    ["30092026", "DDMMYYYY"],
    ["-9302026", "sign"],
    ["9.302026", "decimal point"],
    ["0930 2026", "inner space"],
    ["093020261", "9 digits"],
  ])("%s (%s) is rejected", (v) => {
    h.given(rec({ EmploymentEndDate: v })).expectFinding({ messageId: "825", field: "EmploymentEndDate", params: { 1: v }, dataImportMessage: `${v} is invalid. Date must be in MMDDYYYY format.` });
  });
  it.each(["02292024", "02292000", "12312999", "01011900", " 09302026 ", "1012026", "12312026"])("%s is accepted (incl. left padding and leap years)", (v) => {
    h.given(rec({ EmploymentEndDate: v })).expectNoFinding();
  });
  it("the message echoes the trimmed raw value, not the padded one", () => {
    h.given(rec({ EmploymentEndDate: " 1332026 " })).expectFinding({ params: { 1: "1332026" } });
  });
});

describe("QA/rules: I7 decimal boundaries (6503 CY / 6642 PY)", () => {
  const h = ruleHarness(I7);
  it.each(["12.345", "0.001", "1,234.00", "1e3", "1 234", "12..5", "$12.00", "12.5%", "NaN", "Infinity", "--1", "1-"])("%s fires", (v) => {
    h.given(rec({ Weeks_CurrentYear: v })).expectFinding({ messageId: "6503", field: "Weeks_CurrentYear", yearScope: "CURRENT", params: { 1: v }, dataImportMessage: `${v} is invalid. Value cannot have more than two decimal places.`, portalMessage: "The decimal value is invalid. Value cannot have more than two decimal places." });
  });
  it.each(["12", "12.", ".5", "12.5", "12.50", "+12.50", "-12.50", " 12.50 ", "0", "0.00", "00012.50"])("%s does not fire", (v) => {
    h.given(rec({ Weeks_CurrentYear: v })).expectNoFinding();
  });
  it("previous-year fields use message id 6642 and PREVIOUS scope", () => {
    for (const col of ["Weeks_PreviousYear", "LowContributions_PreviousYear", "HighContributions_PreviousYear"] as const) {
      h.given(rec({ [col]: "1.234" })).expectFinding({ messageId: "6642", field: col, yearScope: "PREVIOUS" });
    }
    for (const col of ["Weeks_CurrentYear", "LowContributions_CurrentYear", "HighContributions_CurrentYear"] as const) {
      h.given(rec({ [col]: "1.234" })).expectFinding({ messageId: "6503", field: col, yearScope: "CURRENT" });
    }
  });
  it("integer fields are never checked by I7 (I8 owns them)", () => {
    h.given(rec({ PA_CurrentYear: "1.234", AnnualizedEarnings_CurrentYear: "abc" })).expectNoFinding();
  });
});

describe("QA/rules: I8 integer boundaries (5131)", () => {
  const h = ruleHarness(I8);
  it.each(["5.0", "5.", "-1", "+5", "1e3", "12 345", "1,234", "0x1F", "5½", "٣"])("%s fires for PA_CurrentYear", (v) => {
    h.given(rec({ PA_CurrentYear: v })).expectFinding({ messageId: "5131", field: "PA_CurrentYear", params: { 1: v }, dataImportMessage: `${v} is in an invalid number format. Please provide an integer value.` });
  });
  it.each(["0", "5", "00005", " 12594 ", "999999999"])("%s does not fire", (v) => {
    h.given(rec({ PA_CurrentYear: v })).expectNoFinding();
  });
  it("SIN variants: spaces, dashes, 10 digits and letters fire; the SIN value is never echoed", () => {
    for (const v of ["900 000 019", "900-000-019", "9000000190", "90000001A", "O00000019"]) {
      const f = h.given(rec({ SIN: v })).expectFinding({ field: "SIN", params: { 1: "SIN" }, dataImportMessage: "SIN is in an invalid number format. Please provide an integer value.", calculated: { masked: true } });
      expect(JSON.stringify(f)).not.toContain(v.replace(/\s|-/g, ""));
    }
  });
  it("short SINs are left-padded by the layout rule and therefore valid integers", () => {
    h.given(rec({ SIN: "19" })).expectNoFinding();
    h.given(rec({ SIN: "000000019" })).expectNoFinding();
  });
});

describe("QA/rules: I9 EventType enum (8034)", () => {
  const h = ruleHarness(I9);
  it("is case-sensitive (AMBIGUOUS in spec: documented as deviation candidate)", () => {
    h.given(rec({ EventType: "terfin" })).expectFinding({ messageId: "8034", params: { 1: "terfin" }, dataImportMessage: "terfin is in an invalid code." });
    h.given(rec({ EventType: "Terfin" })).expectFinding();
  });
  it("trims surrounding whitespace and accepts the three codes", () => {
    for (const v of ["TERFIN", "DECFIN", "RETFIN", " RETFIN ", "TERFIN\t"]) h.given(rec({ EventType: v })).expectNoFinding();
  });
  it("blank is I1 territory, not I9", () => {
    h.given(rec({ EventType: "   " })).expectNoFinding();
  });
});

describe("QA/rules: I10 duplicate SIN (910)", () => {
  const h = ruleHarness(I10);
  function two(a: string, b: string) {
    const r1 = rec({ SIN: a }, 2);
    const r2 = rec({ SIN: b }, 3);
    const ctx = ctxOf({ records: [r1, r2] });
    return { r1, r2, ctx };
  }
  it("padded and whitespace variants of the same SIN are duplicates; both rows are rejected", () => {
    for (const [a, b] of [["900000019", "900000019"], ["19", "000000019"], ["900000019", " 900000019 "]]) {
      const { r1, r2, ctx } = two(a, b);
      h.given(r1, ctx).expectFinding({ messageId: "910", field: "SIN", params: { 1: "***-***-019" }, calculated: { occurrences: 2, masked: true } });
      h.given(r2, ctx).expectFinding({ messageId: "910" });
    }
  });
  it("different SINs and 10-digit near-misses are not duplicates", () => {
    const { r1, r2, ctx } = two("900000019", "0900000019");
    h.given(r1, ctx).expectNoFinding();
    h.given(r2, ctx).expectNoFinding();
  });
  it("three occurrences report occurrences=3 on every row", () => {
    const rs = [rec({ SIN: "900000019" }, 2), rec({ SIN: "900000019" }, 3), rec({ SIN: "900000019" }, 4)];
    const ctx = ctxOf({ records: rs });
    for (const r of rs) h.given(r, ctx).expectFinding({ calculated: { occurrences: 3 } });
  });
  it("the DataImport message never contains the raw SIN", () => {
    const { r1, ctx } = two("900000019", "900000019");
    const f = h.given(r1, ctx).expectFinding();
    expect(f.dataImportMessage).toBe("***-***-019 appears multiple times in file. Please review data for each instance and only submit one instance of correct data.");
    expect(JSON.stringify(f)).not.toContain("900000019");
  });
});

describe("QA/rules: I32 / I55 cross-field boundaries", () => {
  const h32 = ruleHarness(I32);
  const h55 = ruleHarness(I55);
  it("I32 fires only when BOTH weeks and AE are strictly > 0 (per scope)", () => {
    h32.given(rec({ Weeks_CurrentYear: "0.01", AnnualizedEarnings_CurrentYear: "1" })).expectFinding({ messageId: "4999", field: "Weeks_CurrentYear", yearScope: "CURRENT", dataImportMessage: "Weeks and Annualized Earnings cannot both be greater than 0.", portalMessage: "Weeks and Annualized Earnings cannot both be greater than 0" });
    h32.given(rec({ Weeks_CurrentYear: "0", AnnualizedEarnings_CurrentYear: "50000" })).expectNoFinding();
    h32.given(rec({ Weeks_CurrentYear: "0.00", AnnualizedEarnings_CurrentYear: "50000" })).expectNoFinding();
    h32.given(rec({ Weeks_CurrentYear: "10", AnnualizedEarnings_CurrentYear: "0" })).expectNoFinding();
    h32.given(rec({ Weeks_CurrentYear: "10", AnnualizedEarnings_CurrentYear: "" })).expectNoFinding();
    h32.given(rec({ Weeks_PreviousYear: "1", AnnualizedEarnings_PreviousYear: "1" })).expectFinding({ yearScope: "PREVIOUS", field: "Weeks_PreviousYear" });
  });
  it("I32 can fire for both scopes on one row (two findings)", () => {
    h32.given(rec({ Weeks_CurrentYear: "1", AnnualizedEarnings_CurrentYear: "1", Weeks_PreviousYear: "1", AnnualizedEarnings_PreviousYear: "1" })).expectCount(2);
  });
  it("I32 skips fields that failed format parsing (I7/I8 already reject the row)", () => {
    h32.given(rec({ Weeks_CurrentYear: "abc", AnnualizedEarnings_CurrentYear: "1" })).expectNoFinding();
  });
  it("I55 fires for weeks > 0 with low = 0 / 0.00 / 0.0; not for low blank (AMBIGUOUS: blank != $0; CY blank is I1)", () => {
    for (const zero of ["0", "0.00", "0.0", "-0"]) h55.given(rec({ Weeks_CurrentYear: "1", LowContributions_CurrentYear: zero })).expectFinding({ messageId: "9349", field: "LowContributions_CurrentYear", yearScope: "CURRENT", dataImportMessage: "You have provided weeks for this member, please provide associated contributions." });
    h55.given(rec({ Weeks_CurrentYear: "0", LowContributions_CurrentYear: "0" })).expectNoFinding();
    h55.given(rec({ Weeks_CurrentYear: "1", LowContributions_CurrentYear: "0.01" })).expectNoFinding();
    h55.given(rec({ Weeks_PreviousYear: "1", LowContributions_PreviousYear: "" })).expectNoFinding();
    h55.given(rec({ Weeks_PreviousYear: "1", LowContributions_PreviousYear: "0" })).expectFinding({ yearScope: "PREVIOUS", field: "LowContributions_PreviousYear" });
  });
  it("I55 with negative weeks does not fire (B187 owns negatives)", () => {
    h55.given(rec({ Weeks_CurrentYear: "-1", LowContributions_CurrentYear: "0" })).expectNoFinding();
  });
});

describe("QA/rules: B187 negative values (6 rules)", () => {
  const EXPECT: Array<[string, EventsCsvColumn, string, string]> = [
    ["B187_WeeksCurrentYear", "Weeks_CurrentYear", "9099", "Weeks Current Year"],
    ["B187_LowContributionsCurrentYear", "LowContributions_CurrentYear", "4423", "Low Contributions current year"],
    ["B187_HighContributionsCurrentYear", "HighContributions_CurrentYear", "4869", "High Contributions current year"],
    ["B187_WeeksPreviousYear", "Weeks_PreviousYear", "7902", "Weeks previous year"],
    ["B187_LCPreviousYear", "LowContributions_PreviousYear", "494", "Low Contributions previous year"],
    ["B187_HCPreviousYear", "HighContributions_PreviousYear", "5049", "High Contributions previous year"],
  ];
  it.each(EXPECT)("%s -> %s / %s with verbatim portal label %s", (id, field, messageId, label) => {
    const rule = B187_RULES.find((r) => r.id === id)!;
    const h = ruleHarness(rule);
    h.given(rec({ [field]: "-0.01" } as Partial<RawValues>)).expectFinding({ messageId, field, params: { 0: "-0.01" }, dataImportMessage: "Negative value cannot be reported for -0.01.", portalMessage: `Negative value cannot be reported for ${label}.` });
    h.given(rec({ [field]: " -5 " } as Partial<RawValues>)).expectFinding({ params: { 0: "-5" } });
    h.given(rec({ [field]: "-0" } as Partial<RawValues>)).expectNoFinding();
    h.given(rec({ [field]: "-0.00" } as Partial<RawValues>)).expectNoFinding();
    h.given(rec({ [field]: "0" } as Partial<RawValues>)).expectNoFinding();
    h.given(rec({ [field]: "abc" } as Partial<RawValues>)).expectNoFinding();
  });
  it("each B187 rule only watches its own field", () => {
    const all = rec({ Weeks_CurrentYear: "-1", LowContributions_CurrentYear: "-1", HighContributions_CurrentYear: "-1", Weeks_PreviousYear: "-1", LowContributions_PreviousYear: "-1", HighContributions_PreviousYear: "-1" });
    for (const rule of B187_RULES) ruleHarness(rule).given(all).expectCount(1);
  });
  it("B187 still fires when I7 also fires (too many decimals + negative)", () => {
    const ids = engineFindings({ Weeks_CurrentYear: "-1.234" }).map((f) => f.messageId).sort();
    expect(ids).toEqual(["6503", "9099", "9519"]); // -1.234 is also 6 chars > 5 (I3)
  });
});

describe("QA/rules: I1 / I2 mandatory fields", () => {
  const h1 = ruleHarness(I1);
  const h2 = ruleHarness(I2);
  it("whitespace-only is blank; literal 0 is not", () => {
    h1.given(rec({ PA_CurrentYear: "   " })).expectFinding({ messageId: "8233", field: "PA_CurrentYear", params: { 1: "PA_CurrentYear" }, dataImportMessage: "PA_CurrentYear is a required field.", portalMessage: "A mandatory field was not provided in the data file." });
    h1.given(rec({ PA_CurrentYear: "0", Weeks_CurrentYear: "0", LowContributions_CurrentYear: "0" })).expectNoFinding();
    h2.given(rec({ SIN: " \t " })).expectFinding({ messageId: "2031", field: "SIN" });
  });
  it("EmploymentEndDate is mandatory for TERFIN and RETFIN only", () => {
    h1.given(rec({ EventType: "TERFIN", EmploymentEndDate: "" })).expectFinding({ field: "EmploymentEndDate" });
    h1.given(rec({ EventType: "RETFIN", EmploymentEndDate: "" })).expectFinding({ field: "EmploymentEndDate" });
    h1.given(rec({ EventType: "DECFIN", EmploymentEndDate: "" })).expectNoFinding();
    h1.given(rec({ EventType: "BOGUS", EmploymentEndDate: "" })).expectNoFinding();
  });
  it("all six always-mandatory fields blank -> six I1 findings in layout order; SIN blank is I2 not I1", () => {
    const r = rec({ SIN: "", LastName: "", FirstName: "", EventType: "", Weeks_CurrentYear: "", LowContributions_CurrentYear: "", PA_CurrentYear: "" });
    const f = h1.given(r).findings;
    expect(f.map((x) => x.field)).toEqual(["LastName", "FirstName", "EventType", "Weeks_CurrentYear", "LowContributions_CurrentYear", "PA_CurrentYear"]);
    h2.given(r).expectCount(1);
  });
  it("optional fields blank never trigger I1", () => {
    h1.given(rec({ HighContributions_CurrentYear: "", AnnualizedEarnings_CurrentYear: "", Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "" })).expectNoFinding();
  });
  it("engine: I2 suppresses I10 for a blank-SIN row but the other L1 rules still run", () => {
    const r1 = rec({ SIN: "", Weeks_CurrentYear: "-1" }, 2);
    const r2 = rec({ SIN: "" }, 3);
    const ctx = ctxOf({ records: [r1, r2] });
    const ids = runRecordRules(r1, ctx, deps).map((f) => f.ruleId);
    expect(ids).toContain("I2");
    expect(ids).toContain("B187_WeeksCurrentYear");
    expect(ids).not.toContain("I10");
    expect(ids).not.toContain("I42");
  });
});

describe("QA/rules: I42 future date uses the injected execution date (determinism)", () => {
  const h = ruleHarness(I42);
  it("event date == execution date passes; +1 day fires; wall clock is irrelevant", () => {
    const exec = "2026-10-08" as const;
    const r = rec({ EmploymentEndDate: "10082026" });
    h.given(r, ctxOf({ records: [r], executionDate: exec })).expectNoFinding();
    const r2 = rec({ EmploymentEndDate: "10092026" });
    h.given(r2, ctxOf({ records: [r2], executionDate: exec })).expectFinding({ messageId: "8106", field: "EmploymentEndDate", calculated: { eventDate: "2026-10-09", executionDate: exec } });
    // Same row, execution date moved a day later: no finding. Proves the clock is injected, not Date.now().
    h.given(r2, ctxOf({ records: [r2], executionDate: "2026-10-09" })).expectNoFinding();
    const far = rec({ EmploymentEndDate: "01012999" });
    h.given(far, ctxOf({ records: [far], executionDate: "2026-01-01" })).expectFinding();
  });
  it("RETFIN follows the i42ApplyToRetfin switch", () => {
    const r = rec({ EventType: "RETFIN", EmploymentEndDate: "12312027" });
    h.given(r, ctxOf({ records: [r], i42ApplyToRetfin: true })).expectFinding();
    h.given(r, ctxOf({ records: [r], i42ApplyToRetfin: false })).expectNoFinding();
  });
  it("DECFIN uses EmploymentEndDate as the death date and reports the CSV column", () => {
    const r = rec({ EventType: "DECFIN", EmploymentEndDate: "12312027" });
    h.given(r, ctxOf({ records: [r] })).expectFinding({ field: "EmploymentEndDate" });
  });
  it("an unparseable date is I5 territory: I42 stays silent", () => {
    const r = rec({ EmploymentEndDate: "13992099" });
    h.given(r, ctxOf({ records: [r] })).expectNoFinding();
  });
});

const HEADER = "SIN,LastName,FirstName,EventType,EmploymentEndDate,Weeks_CurrentYear,LowContributions_CurrentYear,HighContributions_CurrentYear,AnnualizedEarnings_CurrentYear,PA_CurrentYear,Weeks_PreviousYear,LowContributions_PreviousYear,HighContributions_PreviousYear,AnnualizedEarnings_PreviousYear,PA_PreviousYear";
const ROW = Object.values(VALID_TERFIN).join(",");

/** Parses bytes and runs L0; returns {header, rows, l0 message ids, calculated}. */
function l0(bytes: Buffer) {
  const parsed = parseEventsCsv(bytes);
  const records = parsed.rows.map((row) => buildRecord(row, { batchId: "b", pseudonymKey: KEY, newId: () => "r" }));
  const ctx = ctxOf({ header: parsed.header.observed, rows: parsed.rows, records, encodingProblem: parsed.encodingProblem });
  const { findings } = runFileRules(ctx, deps);
  return { parsed, findings, ids: findings.map((f) => f.messageId), calc: findings[0]?.calculated };
}
const text = (s: string) => Buffer.from(s, "latin1");

describe("QA/rules: L0 header & file-structure probes (I50/130, I51/4887)", () => {
  it("canonical file: no L0 findings; CRLF, LF and mixed line endings are equivalent", () => {
    expect(l0(text(`${HEADER}\r\n${ROW}\r\n`)).ids).toEqual([]);
    expect(l0(text(`${HEADER}\n${ROW}\n`)).ids).toEqual([]);
  });
  it("BUG-PARSE-1 (fixed): mixed CRLF/LF/CR line endings in any order parse as separate rows with correct line numbers", () => {
    const mixed = l0(text(`${HEADER}\r\n${ROW}\n${ROW.replace("900000019", "900000027")}\r\n`));
    expect(mixed.ids).toEqual([]);
    expect(mixed.parsed.rows.map((r) => r.lineNumber)).toEqual([2, 3]);
    const three = l0(text(`${HEADER}\n${ROW}\r${ROW.replace("900000019", "900000027")}\r\n${ROW.replace("900000019", "900000035")}\n`));
    expect(three.ids).toEqual([]);
    expect(three.parsed.rows.map((r) => r.lineNumber)).toEqual([2, 3, 4]);
    expect(three.parsed.lineCount).toBe(4);
  });
  it("mixed line endings with the first break LF parse correctly", () => {
    const mixed = l0(text(`${HEADER}\n${ROW}\r\n${ROW.replace("900000019", "900000027")}\n`));
    expect(mixed.ids).toEqual([]);
    expect(mixed.parsed.rows).toHaveLength(2);
  });
  it("trailing blank lines are ignored (not rows, not I50)", () => {
    const p = l0(text(`${HEADER}\r\n${ROW}\r\n\r\n\r\n\r\n`));
    expect(p.ids).toEqual([]);
    expect(p.parsed.rows).toHaveLength(1);
  });
  it("UTF-8 BOM before the header is stripped (no I51)", () => {
    expect(l0(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), text(`${HEADER}\r\n${ROW}\r\n`)])).ids).toEqual([]);
  });
  it("header labels are case-sensitive (AMBIGUOUS in spec) -> I51", () => {
    const p = l0(text(`${HEADER.replace("SIN", "sin")}\r\n${ROW}\r\n`));
    expect(p.ids).toEqual(["4887"]);
    expect(p.calc).toMatchObject({ reason: "INVALID_HEADER", invalidLabels: "sin" });
  });
  it("header whitespace is tolerated; a space inside a label is not", () => {
    expect(l0(text(`${HEADER.replace("SIN,", " SIN ,").replace(",LastName,", ",LastName ,")}\r\n${ROW}\r\n`)).ids).toEqual([]);
    expect(l0(text(`${HEADER.replace("LastName", "Last Name")}\r\n${ROW}\r\n`)).ids).toEqual(["4887"]);
  });
  it("column reorder is allowed and values follow the header, not the position", () => {
    const cols = HEADER.split(",");
    const vals = ROW.split(",");
    const order = [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const p = l0(text(`${order.map((i) => cols[i]).join(",")}\r\n${order.map((i) => vals[i]).join(",")}\r\n`));
    expect(p.ids).toEqual([]);
    expect(p.parsed.rows[0].values.SIN).toBe("900000019");
    expect(p.parsed.rows[0].values.EventType).toBe("TERFIN");
  });
  it("14 columns (missing non-mandatory) -> no L0 finding; missing mandatory column -> I1 per row (test matrix)", () => {
    const cols = HEADER.split(",");
    const vals = ROW.split(",");
    const noPaPy = l0(text(`${cols.slice(0, 14).join(",")}\r\n${vals.slice(0, 14).join(",")}\r\n`));
    expect(noPaPy.ids).toEqual([]);
    expect(noPaPy.parsed.header.missing).toContain("PA_PreviousYear");
    const noPaCy = l0(text(`${cols.filter((c) => c !== "PA_CurrentYear").join(",")}\r\n${vals.filter((_, i) => cols[i] !== "PA_CurrentYear").join(",")}\r\n`));
    expect(noPaCy.ids).toEqual([]);
    const rec0 = buildRecord(noPaCy.parsed.rows[0], { batchId: "b", pseudonymKey: KEY, newId: () => "r" });
    const l1 = runRecordRules(rec0, ctxOf({ header: noPaCy.parsed.header.observed, rows: noPaCy.parsed.rows, records: [rec0] }), deps);
    expect(l1.map((f) => `${f.messageId}:${f.field}`)).toEqual(["8233:PA_CurrentYear"]);
  });
  it("16th header column -> I51 (not I50); extra cell on a data row -> I50 with the first offending line", () => {
    expect(l0(text(`${HEADER},Extra\r\n${ROW},x\r\n`)).ids).toEqual(["4887"]);
    const p = l0(text(`${HEADER}\r\n${ROW}\r\n${ROW},x\r\n`));
    expect(p.ids).toEqual(["130"]);
    expect(p.calc).toMatchObject({ firstOffendingLine: 3, offendingRows: 1, headerWidth: 15 });
  });
  it("STRICTNESS NOTE: a trailing comma on a data row (empty 16th cell) is treated as extra data -> I50", () => {
    expect(l0(text(`${HEADER}\r\n${ROW},\r\n`)).ids).toEqual(["130"]);
  });
  it("STRICTNESS NOTE: a trailing comma on the header (empty label) -> I51", () => {
    expect(l0(text(`${HEADER},\r\n${ROW},\r\n`)).ids).toEqual(["4887"]);
  });
  it("duplicate header label -> I51 with DUPLICATE_HEADER (spec matrix 6926)", () => {
    const p = l0(text(`${HEADER.replace("PA_PreviousYear", "SIN")}\r\n${ROW}\r\n`));
    expect(p.ids).toEqual(["4887"]);
    expect(p.calc).toMatchObject({ reason: "DUPLICATE_HEADER", duplicateLabels: "SIN" });
  });
  it("semicolon- and tab-delimited files collapse to one unknown label -> I51", () => {
    expect(l0(text(`${HEADER.replace(/,/g, ";")}\r\n${ROW.replace(/,/g, ";")}\r\n`)).ids).toEqual(["4887"]);
    expect(l0(text(`${HEADER.replace(/,/g, "\t")}\r\n${ROW.replace(/,/g, "\t")}\r\n`)).ids).toEqual(["4887"]);
  });
  it("UTF-16 (LE/BE, with/without BOM) and NUL-bearing bytes never throw; they end as I51 UNSUPPORTED_ENCODING (BUG-PIPE-1/2)", () => {
    const le = l0(Buffer.from(`${HEADER}\r\n${ROW}\r\n`, "utf16le"));
    expect(le.ids).toEqual(["4887"]);
    expect(le.calc).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected: "UTF16_LE" });
    expect(le.parsed.rows).toHaveLength(0);
    expect(l0(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${HEADER}\r\n`, "utf16le")])).calc).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected: "UTF16_LE" });
    expect(l0(Buffer.from([0xfe, 0xff, 0x00, 0x53, 0x00, 0x49, 0x00, 0x4e])).calc).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected: "UTF16_BE" });
    expect(l0(Buffer.from([0x00, 0x53, 0x00, 0x49, 0x00, 0x4e, 0x00, 0x2c])).calc).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected: "UTF16_BE" });
    expect(l0(Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x2c, 0x0a])).ids).toEqual(["4887"]);
    const nul = l0(text(`${HEADER}\r\n${ROW.replace("ABLE", "AB\u0000LE")}\r\n`));
    expect(nul.ids).toEqual(["4887"]);
    expect(nul.calc).toMatchObject({ reason: "UNSUPPORTED_ENCODING", detected: "NUL_BYTES" });
    // Plain windows-1252 bytes above 0x7f are NOT an encoding problem.
    expect(l0(text(`${HEADER}\r\n${ROW.replace("ABLE", "L\u00c9VESQUE")}\r\n`)).ids).toEqual([]);
  });
  it("empty, 0-byte and whitespace-only files -> I51 EMPTY_FILE; header-only -> clean with zero rows", () => {
    expect(l0(Buffer.alloc(0)).calc).toMatchObject({ reason: "EMPTY_FILE" });
    expect(l0(text("\r\n\r\n")).calc).toMatchObject({ reason: "EMPTY_FILE" });
    expect(l0(text("   \r\n")).calc).toMatchObject({ reason: "EMPTY_FILE" });
    const ho = l0(text(`${HEADER}\r\n`));
    expect(ho.ids).toEqual([]);
    expect(ho.parsed.rows).toHaveLength(0);
  });
  it("quoted cells with embedded commas, quotes and newlines stay one cell (no I50)", () => {
    const row = ROW.replace("ABLE", `"ABLE, JR"`).replace("Anna", `"An""na"`);
    const p = l0(text(`${HEADER}\r\n${row}\r\n`));
    expect(p.ids).toEqual([]);
    expect(p.parsed.rows[0].values.LastName).toBe("ABLE, JR");
    expect(p.parsed.rows[0].values.FirstName).toBe(`An"na`);
    const multi = l0(text(`${HEADER}\r\n${ROW.replace("ABLE", `"AB\r\nLE"`)}\r\n${ROW.replace("900000019", "900000027")}\r\n`));
    expect(multi.ids).toEqual([]);
    expect(multi.parsed.rows).toHaveLength(2);
  });
  it("BUG-PARSE-2 (fixed): line numbers stay physical after quoted cells containing CRLF / LF / CR", () => {
    const multi = l0(text(`${HEADER}\r\n${ROW.replace("ABLE", `"AB\r\nLE"`)}\r\n${ROW.replace("900000019", "900000027")}\r\n`));
    expect(multi.parsed.rows.map((r) => r.lineNumber)).toEqual([2, 4]);
    const twice = l0(text(`${HEADER}\r\n${ROW.replace("ABLE", `"A\r\nB\r\nC"`)}\r\n${ROW.replace("900000019", "900000027").replace("ABLE", `"X\nY"`)}\r\n${ROW.replace("900000019", "900000035")}\r\n`));
    expect(twice.ids).toEqual([]);
    expect(twice.parsed.rows.map((r) => r.lineNumber)).toEqual([2, 5, 7]);
    const lf = l0(text(`${HEADER}\n${ROW.replace("ABLE", `"AB\nLE"`)}\n${ROW.replace("900000019", "900000027")}\n`));
    expect(lf.parsed.rows.map((r) => r.lineNumber)).toEqual([2, 4]);
  });
  it("an unterminated quote does not throw; the file is rejected at L0 rather than silently mis-parsed", () => {
    const p = l0(text(`${HEADER}\r\n${ROW.replace("ABLE", `"ABLE`)}\r\n`));
    expect(p.ids.length + p.parsed.rows.length).toBeGreaterThan(0);
  });
  it("a row with fewer cells than the header is tolerated (missing -> null, I1 decides)", () => {
    const p = l0(text(`${HEADER}\r\n900000019,ABLE,Anna,TERFIN\r\n`));
    expect(p.ids).toEqual([]);
    expect(p.parsed.rows[0].values.Weeks_CurrentYear).toBeNull();
  });
  it("I50 and I51 are FILE_ERROR, L0, PUBLIC with verbatim messages", () => {
    expect(I50).toMatchObject({ level: "L0", severity: "FILE_ERROR", visibility: "PUBLIC", messageId: "130", dataImportMessage: "The imported file contains data that is not associated with a valid column header." });
    expect(I51).toMatchObject({ level: "L0", severity: "FILE_ERROR", visibility: "PUBLIC", messageId: "4887", dataImportMessage: "The imported file contains invalid column headers." });
  });
});

describe("QA/rules: engine composition", () => {
  it("12345.678 in Weeks_CurrentYear yields BOTH 9519 and 6503 (legacy emits all format messages)", () => {
    expect(engineFindings({ Weeks_CurrentYear: "12345.678" }).map((f) => f.messageId).sort()).toEqual(["6503", "9519"]);
  });
  it("a fully broken row reports every applicable L1 message once per field, in registry order", () => {
    const f = engineFindings({ SIN: "ABC", LastName: "", EventType: "RETIRE", EmploymentEndDate: "13992026", Weeks_CurrentYear: "-1.234", LowContributions_CurrentYear: "x", PA_CurrentYear: "1.5", AnnualizedEarnings_CurrentYear: "-3" });
    expect(f.map((x) => x.ruleId)).toEqual(["I1", "I9", "I5", "I8", "I8", "I8", "I7", "I7", "I3", "B187_WeeksCurrentYear"]);
    expect(new Set(f.map((x) => x.severity))).toEqual(new Set(["COMPLETE_MEMBER_ERROR"]));
  });
  it("the same input evaluated twice yields identical findings (determinism)", () => {
    const a = engineFindings({ Weeks_CurrentYear: "-1.234", EventType: "retfin" });
    const b = engineFindings({ Weeks_CurrentYear: "-1.234", EventType: "retfin" });
    const strip = (xs: typeof a) => xs.map(({ findingId: _i, recordId: _r, createdAt: _c, ...rest }) => rest);
    expect(strip(a)).toEqual(strip(b));
  });
  it("disabled rules are skipped via config", () => {
    const f = engineFindings({ EventType: "retfin" }, { disabled: ["I9"] });
    expect(f.map((x) => x.ruleId)).not.toContain("I9");
  });
});

describe("QA/rules: render helpers", () => {
  it("renderMessage substitutes numeric and named keys and leaves unknown placeholders", () => {
    expect(renderMessage("{1} and {File.FieldName} but {9}", { 1: "a", "File.FieldName": "b" })).toBe("a and b but {9}");
  });
  it("hasUnresolvedPlaceholders is stateless across consecutive calls (regex lastIndex bug guard)", () => {
    expect(hasUnresolvedPlaceholders("{1} x")).toBe(true);
    expect(hasUnresolvedPlaceholders("{2}")).toBe(true);
    expect(hasUnresolvedPlaceholders("{1} x")).toBe(true);
    expect(hasUnresolvedPlaceholders("plain")).toBe(false);
  });
});
