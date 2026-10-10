import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { buildRulesConfig, readRulesConfigFile, ruleEnabled, toleranceKeysFor, toleranceNumber, toleranceString } from "@/lib/rules/config";
import { calculateAE } from "@/lib/rules/lib/ae";
import { breakCovering, isPartTimeAnyDay, ltdBreakIn } from "@/lib/rules/lib/breaks";
import { carveOut, EXCESS_CARVE_TYPES } from "@/lib/rules/lib/carve-out";
import { derivedFor, isMdcCoreData, scopePresent, zeroOrBlank } from "@/lib/rules/lib/context";
import { addDays, addYears, daysBetween, daysInYear, messageDate } from "@/lib/rules/lib/dates";
import { money, pct2, weeks2, whole } from "@/lib/rules/lib/format";
import { expectedService, reportedService, txView } from "@/lib/rules/lib/service";
import { brk, contrib, ctsrv, employment, RATES, salaryRate } from "../helpers/ariel-fixtures";
import { ctxOf, rec } from "../helpers/rule-harness";

describe("rules/lib: carve-out (spec IdentifiedBreaks trim/merge)", () => {
  const w = { start: "2025-01-01" as const, endInclusive: "2025-12-31" as const, clipEnd: "2026-01-01" as const };
  it("clips to the window and sums days exclusive of the end date", () => {
    expect(carveOut([brk("LTD", "2024-11-01", "2025-02-01")], w, EXCESS_CARVE_TYPES).days).toBe(31);
    expect(carveOut([brk("LTD", "2025-12-01", null)], w, EXCESS_CARVE_TYPES).days).toBe(31);
    expect(carveOut([brk("PAR", "2025-03-01", "2025-04-01")], w, EXCESS_CARVE_TYPES).days).toBe(0);
  });
  it("de-overlaps: contained, trailing, leading and enclosing breaks are counted once", () => {
    expect(carveOut([brk("LTD", "2025-03-01", "2025-06-01"), brk("NCM", "2025-04-01", "2025-05-01")], w, EXCESS_CARVE_TYPES).days).toBe(92);
    expect(carveOut([brk("LTD", "2025-03-01", "2025-06-01"), brk("NCM", "2025-05-01", "2025-08-01")], w, EXCESS_CARVE_TYPES).days).toBe(153);
    expect(carveOut([brk("NCM", "2025-05-01", "2025-08-01"), brk("LTD", "2025-03-01", "2025-06-01")], w, EXCESS_CARVE_TYPES).days).toBe(153);
    expect(carveOut([brk("NCM", "2025-04-01", "2025-05-01"), brk("LTD", "2025-03-01", "2025-06-01")], w, EXCESS_CARVE_TYPES).days).toBe(92);
    expect(carveOut([brk("NCM", "2025-04-01", "2025-05-01"), brk("LTD", "2025-04-01", "2025-05-01")], w, EXCESS_CARVE_TYPES).days).toBe(30);
  });
});

describe("rules/lib: breaks, dates, format", () => {
  it("isPartTimeAnyDay falls back to the employment type when no history exists and detects in-year switches", () => {
    expect(isPartTimeAnyDay(employment({ employmentType: "PT" }), 2026)).toBe(true);
    expect(isPartTimeAnyDay(employment({ employmentType: "FT" }), 2026)).toBe(false);
    expect(isPartTimeAnyDay(employment({ employmentTypeHistory: [{ type: "FT", effectiveDate: "2015-03-02" }, { type: "PT", effectiveDate: "2026-06-01" }] }), 2026)).toBe(true);
    expect(isPartTimeAnyDay(employment({ employmentTypeHistory: [{ type: "PT", effectiveDate: "2027-01-01" }] }), 2026)).toBe(true);
    expect(isPartTimeAnyDay(employment({ employmentTypeHistory: [{ type: "FT", effectiveDate: "2027-01-01" }] }), 2026)).toBe(false);
  });
  it("ltdBreakIn / breakCovering treat open ends as 2200-12-31 and support inclusive ends", () => {
    expect(ltdBreakIn(employment({ serviceBreaks: [brk("LTD", "2024-01-01", "2025-01-01")] }), 2025)).toHaveLength(0);
    expect(ltdBreakIn(employment({ serviceBreaks: [brk("LTD", "2024-01-01", null)] }), 2025)).toHaveLength(1);
    expect(breakCovering(employment({ serviceBreaks: [brk("LTD", "2025-01-01", "2025-12-31")] }), "LTD", "2025-01-01", "2025-12-31")).toBeNull();
    expect(breakCovering(employment({ serviceBreaks: [brk("LTD", "2025-01-01", "2025-12-31")] }), "LTD", "2025-01-01", "2025-12-31", true)).not.toBeNull();
  });
  it("civil-date helpers", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(daysBetween("2025-01-01", "2026-01-01")).toBe(365);
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2100)).toBe(365);
    expect(messageDate("2026-06-30")).toBe("06-30-2026");
  });
  it("money/weeks/whole/pct formatting", () => {
    expect(money(-1234.5)).toBe("-1,234.50");
    expect(money("1234567.891")).toBe("1,234,567.89");
    expect(weeks2(38)).toBe("38.00");
    expect(whole(2.5)).toBe(3);
    expect(pct2(new Decimal(20.004))).toBe("20.00");
  });
});

describe("rules/lib: AE, service and context helpers", () => {
  it("calculateAE prefers a REPORT salary rate, returns 0 without service, and applies the retro variants", () => {
    const emp = employment({ salaryRates: [salaryRate(2025, 70000), salaryRate(2025, 71000, { effectiveDate: "2025-06-01" })] });
    expect(calculateAE(txView(emp, null), 2025, RATES)).toMatchObject({ source: "REPORT", ae: new Decimal(71000) });
    expect(calculateAE(txView(employment(), null), 2025, RATES)).toMatchObject({ source: "NONE" });
    const retro = employment({ service: [ctsrv(2025, 52)], contributions: [contrib(2025, "RPPLOW", 4919.7), contrib(2024, "RPPLOW", 100, { summaryAttribute: "RRETRO", paymentDate: "2025-03-01", indicator: "RETRO" })] });
    const std = calculateAE(txView(retro, null), 2025, RATES)!.ae;
    const paid = calculateAE(txView(retro, null), 2025, RATES, "retroPaid")!.ae;
    const withRetro = calculateAE(txView(retro, null), 2025, RATES, "withRetro")!.ae;
    expect(std.toFixed(2)).toBe("71300.00");
    expect(paid.gt(std)).toBe(true);
    expect(withRetro.toFixed(2)).toBe("71300.00");
    const regul = employment({ service: [ctsrv(2025, 52)], contributions: [contrib(2025, "RPPLOW", 4919.7), contrib(2025, "RPPLOW", 500, { indicator: "REGUL" }), contrib(2025, "RCAHGH", 92)] });
    expect(calculateAE(txView(regul, null), 2025, RATES)!.ae.toFixed(2)).toBe("72300.00");
  });
  it("reportedService excludes REGUL unless asked; expectedService guards a zero-length year", () => {
    const v = txView(employment({ service: [ctsrv(2025, 50), ctsrv(2025, 2, { indicator: "REGUL" })] }), null);
    expect(reportedService(v, 2025).toFixed(2)).toBe("50.00");
    expect(reportedService(v, 2025, { includeRegul: true }).toFixed(2)).toBe("52.00");
    expect(expectedService(10, 0, "UP").toFixed(2)).toBe("0.00");
    expect(expectedService(-5, 365, "DOWN").toFixed(2)).toBe("0.00");
  });
  it("context helpers", () => {
    expect(derivedFor(null, ctxOf())).toBeNull();
    const r = rec({});
    expect(derivedFor(r, ctxOf({ records: [r] }))).toBeNull();
    expect(scopePresent(rec({ Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "" }), "PREVIOUS")).toBe(false);
    expect(scopePresent(r, "CURRENT")).toBe(true);
    expect(zeroOrBlank(undefined)).toBe(true);
    expect(zeroOrBlank("0.00")).toBe(true);
    expect(zeroOrBlank("0.01")).toBe(false);
    expect(isMdcCoreData("MDC \u2013 Core Data")).toBe(true);
    expect(isMdcCoreData("mdc - core data")).toBe(true);
    expect(isMdcCoreData("Final Data - Events")).toBe(false);
  });
});

describe("rules/config", () => {
  it("layers overrides, hashes deterministically and resolves tolerances with fallbacks", () => {
    const file = readRulesConfigFile();
    const a = buildRulesConfig({ file });
    const b = buildRulesConfig({ file, overrides: [{ ruleId: "B40", key: "B40.pct", value: 0.2 }, { ruleId: "B181", key: "enabled", value: true }, { ruleId: "B31", key: "B31.windowStart", value: "12-01" }, { ruleId: "X", key: "enabled", value: "nope" }] });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toBe(b.hash);
    expect(buildRulesConfig({ file }).hash).toBe(a.hash);
    expect(b.tolerances["B40.pct"]).toBe(0.2);
    expect(ruleEnabled(b, "B181", false)).toBe(true);
    expect(ruleEnabled(a, "B181", false)).toBe(false);
    expect(ruleEnabled({ ...a, disabled: new Set(["I9"]) }, "I9", true)).toBe(false);
    expect(toleranceNumber(a, "B40.pct", 9)).toBe(0.15);
    expect(toleranceNumber({ tolerances: { x: "1.5" } }, "x", 9)).toBe(1.5);
    expect(toleranceNumber({ tolerances: { x: "abc" } }, "x", 9)).toBe(9);
    expect(toleranceNumber({ tolerances: {} }, "x", 9)).toBe(9);
    expect(toleranceString({ tolerances: {} }, "B31.windowStart", "12-08")).toBe("12-08");
    expect(toleranceString(b, "B31.windowStart", "12-08")).toBe("12-01");
    expect(toleranceKeysFor("B37").map((t) => t.key)).toEqual(["B37.tolerance1Weeks", "B37.tolerance2Dollars"]);
    expect(buildRulesConfig().nhhEmployers).toEqual([]);
  });
  it("rejects an invalid config file", () => {
    const bad = path.join(os.tmpdir(), `rules-bad-${process.pid}.json`);
    writeFileSync(bad, JSON.stringify({ enabled: { B40: "yes" }, nhh: { NHHSIS: "01/01/2019" } }));
    expect(() => readRulesConfigFile(bad)).toThrow(/invalid rules config/);
    rmSync(bad, { force: true });
  });
});
