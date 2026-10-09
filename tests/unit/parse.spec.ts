import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { decodeBytes, encodeText, looksLikeBinary } from "@/lib/events/decode";
import { formatMessageDate, numericValue, parseDateField, parseDecimalField, parseIntegerField } from "@/lib/events/fields";
import { analyseHeader, parseEventsCsv } from "@/lib/events/parse";
import { buildRecord, maskedRawValues, recordParseOk } from "@/lib/events/record";
import { EVENTS_CSV_COLUMNS } from "@/types";
import { csvOf, goldenInput, HEADER_LINE, VALID_TERFIN } from "../helpers/fixtures";

const KEY = Buffer.from("a1".repeat(32), "hex");

describe("decodeBytes", () => {
  it("detects UTF-8 BOM, UTF-8 and windows-1252", () => {
    expect(decodeBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("SIN,x\r\n")]))).toEqual({ text: "SIN,x\r\n", encoding: "utf-8-bom" });
    expect(decodeBytes(Buffer.from("C\u00d4T\u00c9", "utf8"))).toEqual({ text: "C\u00d4T\u00c9", encoding: "utf-8" });
    const ansi = iconv.encode("C\u00d4T\u00c9,Ren\u00e9e", "windows-1252");
    expect(decodeBytes(ansi)).toEqual({ text: "C\u00d4T\u00c9,Ren\u00e9e", encoding: "windows-1252" });
    expect(decodeBytes(Buffer.from("plain ascii"))).toEqual({ text: "plain ascii", encoding: "windows-1252" });
  });
  it("round-trips through encodeText", () => {
    for (const enc of ["windows-1252", "utf-8", "utf-8-bom"] as const) {
      expect(decodeBytes(encodeText("Ren\u00e9e,\u00c9", enc)).text).toBe("Ren\u00e9e,\u00c9");
    }
  });
  it("sniffs binary signatures", () => {
    expect(looksLikeBinary(Buffer.from("PK\u0003\u0004rest"))).toBe("zip");
    expect(looksLikeBinary(Buffer.from("%PDF-1.4"))).toBe("pdf");
    expect(looksLikeBinary(Buffer.from("MZ\u0090\u0000"))).toBe("exe");
    expect(looksLikeBinary(Buffer.from("SIN,LastName"))).toBeNull();
  });
});

describe("field parsers", () => {
  it("decimal: numeric, dot, <= 2 dp, canonical 2 dp", () => {
    expect(parseDecimalField("52")).toEqual({ ok: true, value: "52.00" });
    expect(parseDecimalField(" 1950.2 ")).toEqual({ ok: true, value: "1950.20" });
    expect(parseDecimalField("-1.5")).toEqual({ ok: true, value: "-1.50" });
    expect(parseDecimalField(".5")).toEqual({ ok: true, value: "0.50" });
    expect(parseDecimalField("1.234")).toEqual({ ok: false, reason: "TOO_MANY_DECIMALS" });
    expect(parseDecimalField("1,234")).toEqual({ ok: false, reason: "NOT_NUMERIC" });
    expect(parseDecimalField("abc")).toEqual({ ok: false, reason: "NOT_NUMERIC" });
  });
  it("integer: digits only", () => {
    expect(parseIntegerField("12594")).toEqual({ ok: true, value: 12594 });
    expect(parseIntegerField("0")).toEqual({ ok: true, value: 0 });
    expect(parseIntegerField("-1")).toEqual({ ok: false, reason: "NOT_INTEGER" });
    expect(parseIntegerField("1.0")).toEqual({ ok: false, reason: "NOT_INTEGER" });
    expect(parseIntegerField("+5")).toEqual({ ok: false, reason: "NOT_INTEGER" });
  });
  it("date: MMDDYYYY with left padding", () => {
    expect(parseDateField("07252014")).toEqual({ ok: true, value: "2014-07-25" });
    expect(parseDateField("1012026")).toEqual({ ok: true, value: "2026-01-01" });
    expect(parseDateField("02292023")).toEqual({ ok: false, reason: "INVALID_DATE" });
    expect(parseDateField("00012026")).toEqual({ ok: false, reason: "INVALID_DATE" });
    expect(parseDateField("2026-01-01")).toEqual({ ok: false, reason: "INVALID_DATE" });
    expect(formatMessageDate("2026-09-30")).toBe("09-30-2026");
  });
  it("numericValue tolerates too many decimals (for sign checks) but not text", () => {
    expect(numericValue("-1.234")?.isNegative()).toBe(true);
    expect(numericValue("abc")).toBeNull();
    expect(numericValue("")).toBeNull();
  });
});

describe("analyseHeader / parseEventsCsv", () => {
  it("accepts the layout and reports missing optional columns", () => {
    const h = analyseHeader([...EVENTS_CSV_COLUMNS]);
    expect(h.unknown).toEqual([]);
    expect(h.duplicates).toEqual([]);
    expect(h.missing).toEqual(["DateOfDeath"]);
    expect(h.empty).toBe(false);
  });
  it("flags unknown and duplicate labels, strips BOM and trims", () => {
    const h = analyseHeader(["\uFEFFSIN ", "LastName", "LastName", "Bogus"]);
    expect(h.observed[0]).toBe("SIN");
    expect(h.unknown).toEqual(["Bogus"]);
    expect(h.duplicates).toEqual(["LastName"]);
  });
  it("parses rows, keeps raw strings, maps extra cells and line numbers", () => {
    const text = `${HEADER_LINE}\r\n${Object.values(VALID_TERFIN).join(",")}\r\n\r\n${Object.values(VALID_TERFIN).join(",")},EXTRA\r\n`;
    const p = parseEventsCsv(Buffer.from(text));
    expect(p.encoding).toBe("windows-1252");
    expect(p.lineCount).toBe(4);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].lineNumber).toBe(2);
    expect(p.rows[0].values.SIN).toBe("900000019");
    expect(p.rows[0].values.AnnualizedEarnings_CurrentYear).toBeNull();
    expect(p.rows[1].lineNumber).toBe(4);
    expect(p.rows[1].extraValues).toEqual(["EXTRA"]);
  });
  it("handles quoted commas, short rows and a header-only file", () => {
    const p = parseEventsCsv(Buffer.from(`${HEADER_LINE}\n900000019,"SMITH, JR",John,TERFIN,09302026,38\n`));
    expect(p.rows[0].values.LastName).toBe("SMITH, JR");
    expect(p.rows[0].values.Weeks_CurrentYear).toBe("38");
    expect(p.rows[0].values.PA_CurrentYear).toBeNull();
    const empty = parseEventsCsv(Buffer.from(`${HEADER_LINE}\r\n`));
    expect(empty.rows).toHaveLength(0);
    expect(empty.header.empty).toBe(false);
    expect(parseEventsCsv(Buffer.alloc(0)).header.empty).toBe(true);
  });
  it("decodes the windows-1252 golden file", () => {
    const p = parseEventsCsv(goldenInput("happy-terfin"));
    expect(p.encoding).toBe("windows-1252");
    expect(p.rows[0].values.LastName).toBe("C\u00d4T\u00c9");
    expect(p.rows[0].values.FirstName).toBe("Ren\u00e9e");
  });
});

describe("buildRecord", () => {
  const ctx = { batchId: "00000000-0000-7000-8000-000000000000", pseudonymKey: KEY, newId: () => "r1" };
  it("produces typed fields, pseudonym and mask, never leaking the SIN into masked raw values", () => {
    const p = parseEventsCsv(csvOf([VALID_TERFIN]));
    const r = buildRecord(p.rows[0], ctx);
    expect(r.sin).toBe("900000019");
    expect(r.sinMasked).toBe("***-***-019");
    expect(r.sinPseudo).toMatch(/^[0-9a-f]{64}$/);
    expect(r.eventType).toBe("TERFIN");
    expect(r.employmentEndDate).toBe("2026-09-30");
    expect(r.eventDate).toBe("2026-09-30");
    expect(r.eventYear).toBe(2026);
    expect(r.currentYear).toEqual({ weeks: "38.00", lowContributions: "1950.25", highContributions: "320.50", annualizedEarnings: null, pa: 8450 });
    expect(recordParseOk(r)).toBe(true);
    expect(maskedRawValues(r).SIN).toBe("***-***-019");
    expect(JSON.stringify(maskedRawValues(r))).not.toContain("900000019");
  });
  it("marks unparseable fields undefined and DECFIN uses EmploymentEndDate as the death date (Q1)", () => {
    const p = parseEventsCsv(csvOf([{ ...VALID_TERFIN, EventType: "DECFIN", Weeks_CurrentYear: "1.234", PA_CurrentYear: "x" }]));
    const r = buildRecord(p.rows[0], ctx);
    expect(r.currentYear.weeks).toBeUndefined();
    expect(r.currentYear.pa).toBeUndefined();
    expect(recordParseOk(r)).toBe(false);
    expect(r.dateOfDeath).toBe("2026-09-30");
    expect(r.eventDate).toBe("2026-09-30");
  });
  it("handles a blank SIN and an unknown event type", () => {
    const p = parseEventsCsv(csvOf([{ ...VALID_TERFIN, SIN: "", EventType: "FOO" }]));
    const r = buildRecord(p.rows[0], ctx);
    expect(r.sin).toBeNull();
    expect(r.sinPseudo).toBeNull();
    expect(r.eventType).toBeUndefined();
    expect(r.eventDate).toBeUndefined();
  });
});
