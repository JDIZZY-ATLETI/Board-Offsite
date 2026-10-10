import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { L2_RULES } from "@/lib/rules/events/l2";
import { B5 } from "@/lib/rules/events/l2/B5";
import { B19b } from "@/lib/rules/events/l2/B19b";
import { B22 } from "@/lib/rules/events/l2/B22";
import { B31 } from "@/lib/rules/events/l2/B31";
import { B33 } from "@/lib/rules/events/l2/B33";
import { B37 } from "@/lib/rules/events/l2/B37";
import { B38 } from "@/lib/rules/events/l2/B38";
import { B40 } from "@/lib/rules/events/l2/B40";
import { B43 } from "@/lib/rules/events/l2/B43";
import { B47 } from "@/lib/rules/events/l2/B47";
import { B53a } from "@/lib/rules/events/l2/B53a";
import { B109 } from "@/lib/rules/events/l2/B109";
import { B139 } from "@/lib/rules/events/l2/B139";
import { B184a } from "@/lib/rules/events/l2/B184a";
import { B184c } from "@/lib/rules/events/l2/B184c";
import { B185 } from "@/lib/rules/events/l2/B185";
import { B186a } from "@/lib/rules/events/l2/B186a";
import { B186c } from "@/lib/rules/events/l2/B186c";
import { B192b } from "@/lib/rules/events/l2/B192b";
import { B214 } from "@/lib/rules/events/l2/B214";
import { evaluateRecords, lakeFinding, runRecordRules, type EngineDeps } from "@/lib/rules/engine";
import { placeholderRateRows, StaticRateTables } from "@/lib/ariel/rates";
import { calculatedPA } from "@/lib/rules/lib/ae";
import { carveOut, EXCESS_CARVE_TYPES } from "@/lib/rules/lib/carve-out";
import type { ArielMemberSnapshot, IsoDate, RawValues } from "@/types";
import { brk, contrib, ctsrv, cyBlock, employment, member, pyBlock, RATES, salaryRate, stdMember, ZERO_CY, ZERO_PY } from "../helpers/ariel-fixtures";
import { CLEAN_CY, ctxOf, l2Harness, rec } from "../helpers/rule-harness";

/**
 * QA Phase 2: L2 boundary probes the base specs (tests/rules/<id>.spec.ts) do not pin down. Each block names the
 * spec clause (docs/reference/hoopp-ch7-validations-v15.1.txt) or architecture section it exercises.
 */

const deps: EngineDeps = { newId: () => "f", now: () => new Date("2026-10-08T12:00:00.000Z") };

/** Full L1+L2 engine pass for one row against the given Ariel members (default context: employer 0235, exec 2026-10-08). */
function engine(over: Partial<RawValues>, members: ArielMemberSnapshot[], opts: Partial<Parameters<typeof ctxOf>[0]> = {}) {
  const r = rec({ ...CLEAN_CY, ...over });
  return runRecordRules(r, ctxOf({ records: [r], ariel: members, ...opts }), deps);
}
const l2 = (fs: ReturnType<typeof engine>) => fs.filter((f) => f.level === "L2").map((f) => f.ruleId);

describe("QA/L2: catalogue invariants (architecture 7.9.3-7.9.5)", () => {
  it("41 rules in the 7.9.4 order; WARNING <=> override reasons; INFORMATION <=> PRIVATE; only B181 disabled by default", () => {
    expect(L2_RULES.map((r) => r.id)).toEqual("B2 B204 B224 B5 B223 B109 I42 B112 B113 B139 B192a B192b B22 B19 B19b B31 B33 B37 B38 B184a B184b B184c B185 B186a B186b B186c B53a B53b B181 B182 B40 B41 B43 B44 B47 B214 B207 B203 B205 B206 B202".split(" "));
    for (const r of L2_RULES) {
      expect(r.overrideReasons.length > 0, r.id).toBe(r.severity === "WARNING");
      expect(r.visibility === "PRIVATE", r.id).toBe(r.severity === "INFORMATION");
      expect(r.level, r.id).toBe("L2");
    }
    expect(L2_RULES.filter((r) => r.severity === "WARNING").map((r) => r.id)).toEqual(["B139", "B31", "B33", "B38", "B40", "B43", "B47", "B214"]);
    expect(L2_RULES.filter((r) => !r.enabledByDefault).map((r) => r.id)).toEqual(["B181"]);
    expect(L2_RULES.filter((r) => !r.requiresAriel).map((r) => r.id)).toEqual(["I42"]);
  });
});

describe("QA/L2: rate-table years missing from the tables (architecture 18 Q9; BUG-L2-RATES-1/2 fixed)", () => {
  /** Tables trimmed to 2015-2026 (the Phase 2 placeholder range) so the probes still hit uncovered years. */
  const narrowRates = new StaticRateTables(placeholderRateRows().filter((r) => r.year >= 2015 && r.year <= 2026));
  function evaluateWith(over: Partial<RawValues>, members: ArielMemberSnapshot[], opts: Partial<Parameters<typeof ctxOf>[0]> = {}) {
    const r = rec({ ...CLEAN_CY, ...over });
    const res = evaluateRecords(ctxOf({ records: [r], ariel: members, rates: narrowRates, ...opts }), deps);
    return { findings: res.recordFindings.get(r.recordId) ?? [], skips: res.skips, outcome: res.outcomes.get(r.recordId), timings: res.timings };
  }
  it("placeholder tables now cover 2010-2027 and every row stays flagged placeholder (Q9)", () => {
    const rows = placeholderRateRows();
    expect([...new Set(rows.map((r) => r.year))].sort()).toEqual(Array.from({ length: 18 }, (_, i) => 2010 + i));
    expect(rows.every((r) => r.placeholder)).toBe(true);
    expect(RATES.firstYear()).toBe(2010);
    expect(RATES.ympe(2009)).toBeNull();
    expect(narrowRates.firstYear()).toBe(2015);
  });
  it("BUG-L2-RATES-1 (fixed): a 2027 event with no 2027 rates emits no SYS-RULE-ERROR; B37/B38/B40/B41/B43/B44/B53a skip with RATE_MISSING and the row is not rejected", () => {
    const row: Partial<RawValues> = { EmploymentEndDate: "03312027", Weeks_CurrentYear: "12.00", LowContributions_CurrentYear: "1200.00", HighContributions_CurrentYear: "50.00", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: "2000" };
    const { findings, skips, outcome } = evaluateWith(row, [stdMember({}, [{ year: 2025, ae: 75000 }, { year: 2026, ae: 78000 }])], { executionDate: "2027-10-08" });
    expect(findings.filter((f) => f.ruleId === "SYS-RULE-ERROR")).toEqual([]);
    expect(findings.filter((f) => ["B37", "B38", "B40", "B41", "B43", "B44", "B53a"].includes(f.ruleId))).toEqual([]);
    const byRule = Object.fromEntries(skips.map((s) => [s.ruleId, s.reason]));
    expect(byRule).toMatchObject({ B37: "RATE_MISSING:MGA:2027", B38: "RATE_MISSING:MGA:2027", B53a: "RATE_MISSING:MGA:2027", B40: "RATE_MISSING:MGA:2027", B43: "RATE_MISSING:MGA:2027" });
    expect(skips.every((s) => s.lineNumber === 2)).toBe(true);
    expect(outcome).not.toBe("REJECTED");
  });
  it("BUG-L2-RATES-2 (fixed): B47 starts its back-walk at MAX(Year(permanency), firstRateYear); 2010 service with no 2010 rates neither throws nor fires", () => {
    const base = stdMember().employments[0];
    const m = member({ emp: { permanencyDate: "2010-01-04", service: [...base.service, ctsrv(2010, 52)], contributions: [...base.contributions, contrib(2010, "RPPLOW", 3000)] } });
    const { findings, skips } = evaluateWith({ ...ZERO_PY }, [m]);
    expect(findings.filter((f) => f.ruleId === "SYS-RULE-ERROR")).toEqual([]);
    expect(findings.filter((f) => f.level === "L2").map((f) => f.ruleId)).toEqual([]);
    expect(skips.filter((s) => s.ruleId === "B47")).toEqual([]);
  });
  it("with the shipped 2010-2027 tables the same 2010 history is evaluated (the 2010 AE suppresses B47) and a 2027 event is fully evaluated", () => {
    const base = stdMember().employments[0];
    const m = member({ emp: { permanencyDate: "2010-01-04", service: [...base.service, ctsrv(2010, 52)], contributions: [...base.contributions, contrib(2010, "RPPLOW", 3000)] } });
    expect(l2(engine({ ...ZERO_PY }, [m]))).toEqual([]);
    const row: Partial<RawValues> = { EmploymentEndDate: "03312027", Weeks_CurrentYear: "12.00", LowContributions_CurrentYear: "1200.00", HighContributions_CurrentYear: "50.00", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: "2000" };
    const r = rec({ ...CLEAN_CY, ...row });
    const res = evaluateRecords(ctxOf({ records: [r], ariel: [stdMember({}, [{ year: 2025, ae: 75000 }, { year: 2026, ae: 78000 }])], executionDate: "2027-10-08" }), deps);
    expect(res.skips).toEqual([]);
    expect((res.recordFindings.get(r.recordId) ?? []).some((f) => f.ruleId === "SYS-RULE-ERROR")).toBe(false);
  });
  it("skips are counted per rule in the timings (execution report) and never produce a finding", () => {
    const row: Partial<RawValues> = { EmploymentEndDate: "03312027", Weeks_CurrentYear: "12.00", LowContributions_CurrentYear: "1200.00", HighContributions_CurrentYear: "50.00", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: "2000" };
    const { timings } = evaluateWith(row, [stdMember({}, [{ year: 2025, ae: 75000 }, { year: 2026, ae: 78000 }])], { executionDate: "2027-10-08" });
    const b37 = timings.find((t) => t.ruleId === "B37")!;
    expect(b37.skipped).toBe(1);
    expect(b37.findings).toBe(0);
  });
  it("the same member with service only in covered years is clean", () => {
    const fs = engine({ ...ZERO_PY }, [stdMember({ emp: { permanencyDate: "2010-01-04" } })]);
    expect(l2(fs)).toEqual([]);
  });
  it("SEC-INFO (Phase 2): a rule that throws yields a SYS-RULE-ERROR whose message carries only a reference, while the full error reaches deps.onRuleError", () => {
    const r = rec({ ...CLEAN_CY });
    const errors: Array<{ ruleId: string; ref: string; error: unknown }> = [];
    const throwing = () => {
      throw new Error("secret cell value 123456789");
    };
    const boom = ctxOf({ records: [r], ariel: [stdMember()], rates: { ympe: throwing, paMaxDb: throwing, paOffset: throwing, lowContributionRate: throwing, highContributionRate: throwing, firstYear: () => 2015, rows: () => [] } });
    const fs = runRecordRules(r, boom, { ...deps, onRuleError: (i) => errors.push(i) });
    const sys = fs.filter((f) => f.ruleId === "SYS-RULE-ERROR");
    expect(sys.length).toBeGreaterThan(0);
    expect(JSON.stringify(sys)).not.toContain("secret cell value");
    expect(sys[0].dataImportMessage).toMatch(/Reference [-0-9a-zA-Z]+ - details are in the server log/);
    expect(errors[0].ref).toBe(sys[0].calculated?.errorRef);
    expect((errors[0].error as Error).message).toContain("secret cell value");
  });
});

describe("QA/L2: B40/B43 exact thresholds and the undocumented zero-AE skip (code comment cites a section 18 Q27 that does not exist)", () => {
  const h40 = l2Harness(B40);
  const h43 = l2Harness(B43);
  // 2025 AE fixed at 100,000 through a REPORT salary rate; the file AE (REPORT) is the 2026 value.
  const prior = () => [stdMember({ emp: { salaryRates: [salaryRate(2025, 100000)] } }, [{ year: 2025, ae: 75000 }])];
  it("B40: +15.000 % passes, +15.001 % fires with {1} rendered to two decimals", () => {
    h40.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "115000" }, prior()).expectNoFinding();
    h40.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "115001" }, prior()).expectFinding({ messageId: "1238", yearScope: "CURRENT", params: { 0: "115,001.00", 1: "15.00", 2: "100,000.00" }, calculated: { validationYear: 2026, errorYear: 2026 } });
  });
  it("B43: -2,500 passes, -2,501 fires", () => {
    h43.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "97500" }, prior()).expectNoFinding();
    h43.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "97499" }, prior()).expectFinding({ messageId: "5613", params: { 0: "97,499.00", 1: "2,501.00", 2: "100,000.00" } });
  });
  it("DEVIATION (pinned): a year with no service (AE = 0) after a 100,000 year is NOT a B43/B44 decrease - the spec loop would fire", () => {
    h43.given({ ...ZERO_CY }, prior()).expectNoFinding();
  });
});

describe("QA/L2: B53a tolerance edge (|CalcPA - PA| = 250 fires, 249 does not)", () => {
  const h = l2Harness(B53a);
  // AE 78,000 (file REPORT), 52 weeks -> CalcPA = MIN(34,416, ((3,400 x 0.02 + 74,600 x 0.015) x 9) - 600) = 10,083.00 exactly
  const over: Partial<RawValues> = { ...cyBlock("2026-12-31", 52, 78000), AnnualizedEarnings_CurrentYear: "78000" };
  it("spec: reject when CalcPA - PA <= -250 OR >= +250", () => {
    expect(calculatedPA(new Decimal(78000), new Decimal(1), 2026, RATES)!.toFixed(2)).toBe("10083.00");
    h.given({ ...over, PA_CurrentYear: "10333" }).expectFinding({ messageId: "2160", yearScope: "CURRENT", params: { 2: "PA", 3: 2026, 4: 10083 }, calculated: { calculatedPA: "10083.00", reportedPA: 10333 }, dataImportMessage: "The PA for 2026 is incorrect based on the data provided. The HOOPP calculated value is 10083." });
    h.given({ ...over, PA_CurrentYear: "10332" }).expectNoFinding();
    h.given({ ...over, PA_CurrentYear: "9833" }).expectFinding({ field: "PA_CurrentYear" });
    h.given({ ...over, PA_CurrentYear: "9834" }).expectNoFinding();
  });
});

describe("QA/L2: B184c / B186c mid-year termination edges (Jan 1 .. Sep 30 2026 = 273 days; ES up 38.90, down 38.89)", () => {
  it("B184c: RS = ES + 3 passes, + 3.01 fires", () => {
    const h = l2Harness(B184c);
    h.given({ Weeks_CurrentYear: "41.90" }).expectNoFinding();
    h.given({ Weeks_CurrentYear: "41.91" }).expectFinding({ messageId: "7854", yearScope: "CURRENT", field: "Weeks_CurrentYear", params: { 2: 2026, 3: "38.90" }, calculated: { totalDays: 273, carveOutDays: 0 } });
  });
  it("B186c: RS = 0.65 x ES (25.2785) passes at 25.28, fires at 25.27", () => {
    const h = l2Harness(B186c);
    h.given({ Weeks_CurrentYear: "25.28" }).expectNoFinding();
    h.given({ Weeks_CurrentYear: "25.27" }).expectFinding({ messageId: "9829", params: { 2: 2026, 3: "38.89" }, calculated: { minimumService: "25.28" } });
  });
});

describe("QA/L2: full-year previous-year hand-over B184a / B185 / B186a at exact week boundaries (2025, no MDC posted)", () => {
  const noMdc2025 = () => [stdMember({}, [{ year: 2024, ae: 72000 }])];
  const py = (weeks: number) => pyBlock(2025, weeks, 75000);
  it("B184a: 52.00 passes, 52.01 fires; auto-correct hint = ES - Ariel service", () => {
    const h = l2Harness(B184a);
    h.given(py(52), noMdc2025()).expectNoFinding();
    h.given(py(52.01), noMdc2025()).expectFinding({ messageId: "66", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025, 3: "52.00" }, calculated: { suggestedWeeks: "52.00", arielService: "0.00" } });
  });
  it("B185 owns [ES - 1, ES): 51.00 and 51.99 fire; 52.00 and 50.99 do not", () => {
    const h = l2Harness(B185);
    h.given(py(51), noMdc2025()).expectFinding({ messageId: "3506", yearScope: "PREVIOUS", params: { 2: 2025, 3: "52.00" }, calculated: { suggestedWeeks: "52.00" } });
    h.given(py(51.99), noMdc2025()).expectFinding({ yearScope: "PREVIOUS" });
    h.given(py(52), noMdc2025()).expectNoFinding();
    h.given(py(50.99), noMdc2025()).expectNoFinding();
  });
  it("B186a owns (< ES - 1): 50.99 fires, 51.00 does not", () => {
    const h = l2Harness(B186a);
    h.given(py(50.99), noMdc2025()).expectFinding({ messageId: "573", yearScope: "PREVIOUS", params: { 2: 2025, 3: "52.00" }, calculated: { minimumService: "51.00" } });
    h.given(py(51), noMdc2025()).expectNoFinding();
  });
  it("B185: a REGUL service row in Ariel counts towards RS (spec omits the REGUL filter for B185/B186)", () => {
    const h = l2Harness(B185);
    h.given(py(50), [stdMember({ emp: { service: [ctsrv(2025, 1.5, { indicator: "REGUL" })], contributions: [] } }, [])]).expectFinding({ yearScope: "PREVIOUS", calculated: { reportedService: "51.50", arielService: "1.50" } });
  });
});

describe("QA/L2: B31 window edges (Dec 8 .. Dec 31 of the execution year, spec: PermanencyDate >= Dec 8 AND <= Dec 31)", () => {
  const h = l2Harness(B31);
  const at = (perm: IsoDate) => [stdMember({ emp: { permanencyDate: perm } })];
  const zero: Partial<RawValues> = { ...cyBlock("2025-12-31", 0, 60000), ...ZERO_CY };
  const exec = { executionDate: "2025-10-08" as IsoDate };
  it("Dec 8 and Dec 31 fire; Dec 7 and Jan 1 do not; any weeks > 0 never fires", () => {
    h.given(zero, at("2025-12-08"), exec).expectFinding({ messageId: "7309", field: "Weeks_CurrentYear", calculated: { permanencyDate: "2025-12-08", windowStart: "2025-12-08" } });
    h.given(zero, at("2025-12-31"), exec).expectFinding({});
    h.given(zero, at("2025-12-07"), exec).expectNoFinding();
    h.given(zero, at("2026-01-01"), exec).expectNoFinding();
    h.given(cyBlock("2025-12-31", 0.01, 60000), at("2025-12-15"), exec).expectNoFinding();
  });
  it("the window is keyed on the execution year, not the event year", () => {
    h.given(zero, at("2025-12-15"), { executionDate: "2026-10-08" }).expectNoFinding();
  });
});

describe("QA/L2: B109 event date vs permanency (spec: EmploymentEndDate < PermanencyDate)", () => {
  const h = l2Harness(B109);
  const late = () => [stdMember({ emp: { permanencyDate: "2026-03-16" } }, [])];
  it("event on the permanency date passes; one day earlier fires; a DECFIN DateOfDeath column is the compared field", () => {
    h.given(cyBlock("2026-03-16", 2, 60000), late()).expectNoFinding();
    h.given(cyBlock("2026-03-15", 2, 60000), late()).expectFinding({ messageId: "7476", field: "EmploymentEndDate", calculated: { eventDate: "2026-03-15", permanencyDate: "2026-03-16" } });
    h.given({ ...cyBlock("2026-05-31", 2, 60000), EventType: "DECFIN", DateOfDeath: "03152026" }, late()).expectFinding({ field: "DateOfDeath", calculated: { eventDate: "2026-03-15" } });
    h.given({ ...cyBlock("2026-03-15", 2, 60000), EventType: "DECFIN" }, late()).expectFinding({ field: "EmploymentEndDate" });
  });
});

describe("QA/L2: B139 compares only against a RET termination date in Ariel", () => {
  const h = l2Harness(B139);
  const ret = (termDate: IsoDate | null) => [stdMember({ emp: { terminationCode: "RET", terminationDate: termDate, otherInformation: "RetNotice 2026-06-30" } })];
  it("different date fires with {0} as MM-DD-YYYY; same date, no Ariel date, or TERFIN stay quiet", () => {
    h.given({ EventType: "RETFIN", EmploymentEndDate: "07152026" }, ret("2026-06-30")).expectFinding({ messageId: "2492", field: "EmploymentEndDate", params: { 0: "06-30-2026" }, calculated: { previousTerminationDate: "2026-06-30", employmentEndDate: "2026-07-15" } });
    h.given({ EventType: "RETFIN", EmploymentEndDate: "06302026" }, ret("2026-06-30")).expectNoFinding();
    h.given({ EventType: "RETFIN", EmploymentEndDate: "07152026" }, ret(null)).expectNoFinding();
    h.given({ EventType: "TERFIN", EmploymentEndDate: "07152026" }, ret("2026-06-30")).expectNoFinding();
  });
});

describe("QA/L2: B5 event-type matrix (Final Data R14 variants)", () => {
  const h = l2Harness(B5);
  it("TERFIN: any termination date rejects (even RET); RETFIN/DECFIN: TER/DEC/AMA reject, RET only with CTSRV in the event year", () => {
    h.given({}, [stdMember({ emp: { terminationDate: "2026-06-30", terminationCode: "RET" } })]).expectFinding({ messageId: "5728", field: "EventType", calculated: { reason: "ALREADY_TERMINATED", terminationCode: "RET" } });
    for (const code of ["TER", "DEC", "AMA"] as const) {
      h.given({ EventType: "DECFIN" }, [stdMember({ emp: { terminationDate: "2025-01-31", terminationCode: code } })]).expectFinding({ calculated: { reason: `TERMINATION_CODE_${code}` } });
      h.given({ EventType: "RETFIN" }, [stdMember({ emp: { terminationDate: "2025-01-31", terminationCode: code } })]).expectFinding({ calculated: { reason: `TERMINATION_CODE_${code}` } });
    }
    h.given({ EventType: "RETFIN" }, [stdMember({ emp: { terminationDate: "2026-06-30", terminationCode: "RET" } })]).expectNoFinding();
    h.given({ EventType: "RETFIN" }, [stdMember({ emp: { terminationDate: "2026-06-30", terminationCode: "RET", service: [ctsrv(2026, 8)], contributions: [] } })]).expectFinding({ calculated: { reason: "RET_WITH_CTSRV_IN_YEAR", year: 2026 } });
    h.given({ EventType: "RETFIN" }, [stdMember({ emp: { terminationDate: "2026-06-30", terminationCode: "RET", service: [ctsrv(2025, 52)], contributions: [] } })]).expectNoFinding();
    h.given({ EventType: "DECFIN" }, [stdMember({ emp: { terminationDate: "2026-06-30", terminationCode: "RET", service: [ctsrv(2026, 8)], contributions: [] } })]).expectFinding({ calculated: { reason: "RET_WITH_CTSRV_IN_YEAR" } });
    h.given({ EventType: "DECFIN" }).expectNoFinding();
  });
});

describe("QA/L2: absent / partial Ariel data paths (engine composition, architecture 7.3)", () => {
  it("unknown SIN: B2 (MEMBER_NOT_FOUND) is the only Ariel finding; nothing throws", () => {
    const fs = engine({}, []);
    expect(l2(fs)).toEqual(["B2"]);
    expect(fs.find((f) => f.ruleId === "B2")?.calculated).toMatchObject({ reason: "MEMBER_NOT_FOUND" });
  });
  it("member known but employed elsewhere: B2 NO_EMPLOYMENT_AT_EMPLOYER; every other Ariel rule is skipped", () => {
    const fs = engine({}, [stdMember({ emp: { employerId: "0359" } })]);
    expect(l2(fs)).toEqual(["B2"]);
    expect(fs[0].calculated).toMatchObject({ reason: "NO_EMPLOYMENT_AT_EMPLOYER", employerId: "0235" });
  });
  it("two Ariel members share the SIN: B204 fires; B2 passes because one of them is employed here", () => {
    const fs = engine({ ...ZERO_PY }, [member({ memberId: "mbr-a" }), member({ memberId: "mbr-b", emp: { employerId: "0359" } })]);
    expect(l2(fs)).toContain("B204");
    expect(l2(fs)).not.toContain("B2");
  });
  it("closed + re-opened employment at the same employer: the most recent permanency is the one evaluated (B5 and B224 clean)", () => {
    const m = member({ employments: [employment({ permanencyDate: "2005-01-03", terminationDate: "2012-06-30", terminationCode: "TER" }), employment({ permanencyDate: "2013-01-07" })] });
    const ids = l2(engine({ ...ZERO_PY }, [m]));
    expect(ids).not.toContain("B5");
    expect(ids).not.toContain("B224");
  });
  it("two open employments at the same employer: B224 rejects", () => {
    const m = member({ employments: [employment({ permanencyDate: "2015-03-02" }), employment({ permanencyDate: "2024-02-05" })] });
    expect(l2(engine({ ...ZERO_PY }, [m]))).toContain("B224");
  });
  it("I42 (future event) rejects the row but the other L2 rules are still evaluated (all rules in a level run)", () => {
    const ids = l2(engine({ ...cyBlock("2026-12-31", 38, 78000) }, [stdMember()]));
    expect(ids).toContain("I42");
    expect(ids).toContain("B186a");
    expect(ids).not.toContain("B2");
  });
  it("a blank SIN (I2) suppresses every L2 rule including I42", () => {
    const fs = engine({ SIN: "", EmploymentEndDate: "12312026" }, [stdMember()]);
    expect(fs.map((f) => f.ruleId)).toContain("I2");
    expect(l2(fs)).toEqual([]);
  });
});

describe("QA/L2: B19b previous-year block", () => {
  const h = l2Harness(B19b);
  const wso = (extra: Partial<ArielMemberSnapshot["employments"][number]> = {}) => [stdMember({ emp: { serviceBreaks: [brk("WSO", "2024-06-01")], ...extra } })];
  it("AMBIGUOUS (pinned): an all-blank previous-year block is not evaluated (architecture 7.3) although the spec reads blank AE as 0-or-blank", () => {
    const g = h.given({}, wso());
    g.expectCount(1);
    expect(g.findings[0].yearScope).toBe("CURRENT");
  });
  it("PY weeks present + AE blank + WSO covering 2025 -> fires with {1} = 2025; a 2025 REPORT rate or a 2026 enrolment suppresses the PY finding", () => {
    h.given(pyBlock(2025, 52, 75000), wso()).expectFinding({ messageId: "2955", yearScope: "PREVIOUS", field: "AnnualizedEarnings_PreviousYear", params: { 1: 2025 }, dataImportMessage: "Annualized earnings for 2025 must be provided for this member." });
    h.given(pyBlock(2025, 52, 75000), wso({ salaryRates: [salaryRate(2025, 70000)] })).expectCount(1);
    h.given(pyBlock(2025, 52, 75000), wso({ permanencyDate: "2026-02-02" })).expectCount(1);
  });
});

describe("QA/L2: B22 previous-year window ends at EventDate - 1 year (spec: EndDate >= EmploymentEndDate - 1 year)", () => {
  const h = l2Harness(B22);
  const ltd = (end: IsoDate | null) => [stdMember({ emp: { serviceBreaks: [brk("LTD", "2024-12-01", end)] } })];
  it("LTD ending 2025-09-30 fires for PY weeks; ending 2025-09-29 does not", () => {
    h.given(pyBlock(2025, 10, 60000), ltd("2025-09-30")).expectFinding({ messageId: "5604", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 2: 2025 }, calculated: { ltdEnd: "2025-09-30" } });
    h.given(pyBlock(2025, 10, 60000), ltd("2025-09-29")).expectNoFinding();
  });
  it("PA alone triggers the current year but not the previous year (spec lists no PA for PY)", () => {
    const g = h.given({ ...ZERO_CY, PA_CurrentYear: "100", ...ZERO_PY, PA_PreviousYear: "100" }, ltd(null));
    g.expectCount(1);
    expect(g.findings[0].yearScope).toBe("CURRENT");
  });
});

describe("QA/L2: B214 leave-length threshold (5 days) and WCP arithmetic", () => {
  const h = l2Harness(B214);
  const pt = (leaveEnd: IsoDate) => [stdMember({ emp: { employmentType: "PT", employmentTypeHistory: [{ type: "PT", effectiveDate: "2024-01-01" }], serviceBreaks: [brk("NCP", "2026-02-01", leaveEnd)] } })];
  it("5-day NCP (Feb 1 .. Feb 6 excl.) -> WCP = ROUNDDOWN((273 - 5) / 273 x 52) = 51.04; 51.19 fires, 51.18 passes; a 4-day leave is ignored", () => {
    h.given({ Weeks_CurrentYear: "51.19" }, pt("2026-02-06")).expectFinding({ messageId: "6012", yearScope: "CURRENT", params: { 1: 2026 }, calculated: { workingContributoryPeriod: "51.04", leaveType: "NCP", carveOutDays: 5, spanDays: 273 } });
    h.given({ Weeks_CurrentYear: "51.18" }, pt("2026-02-06")).expectNoFinding();
    h.given({ Weeks_CurrentYear: "51.19" }, pt("2026-02-05")).expectNoFinding();
  });
});

describe("QA/L2: B33 part-time any-day boundary", () => {
  const h = l2Harness(B33);
  const m = (ptFrom: IsoDate) => [stdMember({ emp: { employmentTypeHistory: [{ type: "FT", effectiveDate: "2015-03-02" }, { type: "PT", effectiveDate: ptFrom }], contributions: [contrib(2026, "RPPLOW", 100, { summaryAttribute: "RCL" })] } })];
  it("PT from Dec 31 of the event year counts; PT from Jan 1 of the next year does not", () => {
    h.given({}, m("2026-12-31")).expectFinding({ messageId: "5001", yearScope: "CURRENT", params: { 1: 2026 }, calculated: { trigger: "RPPLOW" } });
    h.given({}, m("2027-01-01")).expectNoFinding();
  });
});

describe("QA/L2: B37 / B38 contribution ceiling and floor at the exact cent (2026: MaxWeekly = 74,600 x 0.069 / 52 = 98.98846)", () => {
  it("B37 with zero weeks still allows two weeks of contributions (Final Data variant has no $5 Tolerance2): 197.97 passes, 197.98 fires", () => {
    const h = l2Harness(B37);
    h.given({ ...ZERO_CY, LowContributions_CurrentYear: "197.97" }).expectNoFinding();
    h.given({ ...ZERO_CY, LowContributions_CurrentYear: "197.98" }).expectFinding({ messageId: "3029", field: "LowContributions_CurrentYear", params: { 1: 2026, 2: "197.98" }, calculated: { calculatedLow: "0.00" } });
  });
  it("B38 floor for 38 weeks = 3,761.56 - 98.99 = 3,662.57: equal passes, one cent below fires", () => {
    const h = l2Harness(B38);
    h.given({ LowContributions_CurrentYear: "3662.57", HighContributions_CurrentYear: "10.00" }).expectNoFinding();
    h.given({ LowContributions_CurrentYear: "3662.56", HighContributions_CurrentYear: "10.00" }).expectFinding({ messageId: "480", params: { 1: 2026, 2: "3,662.57" } });
    h.given({ LowContributions_CurrentYear: "1.00", HighContributions_CurrentYear: "0.00" }).expectNoFinding();
  });
});

describe("QA/L2: B47 bounds (20,000 and 120,000 themselves pass) for a member with no earlier AE history", () => {
  const h = l2Harness(B47);
  const fresh = () => [stdMember({ emp: { permanencyDate: "2025-01-05" } }, [])];
  it("120,000 passes, 120,001 fires; 20,000 passes, 19,999 fires; {1} is the event year", () => {
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "120000" }, fresh()).expectNoFinding();
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "120001" }, fresh()).expectFinding({ messageId: "2990", params: { 0: "120,001.00", 1: 2026 } });
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "20000" }, fresh()).expectNoFinding();
    h.given({ ...ZERO_CY, AnnualizedEarnings_CurrentYear: "19999" }, fresh()).expectFinding({ params: { 0: "19,999.00", 1: 2026 } });
  });
});

describe("QA/L2: B192b blank vs zero", () => {
  const h = l2Harness(B192b);
  const noMdc = () => [stdMember({}, [{ year: 2024, ae: 72000 }])];
  it("blank PY fires (field = first blank column); zeros satisfy; MDC 2025 posted or enrolled in the event year -> quiet", () => {
    h.given({}, noMdc()).expectFinding({ messageId: "7166", yearScope: "PREVIOUS", field: "Weeks_PreviousYear", params: { 0: 2025 }, dataImportMessage: "Previous Year data for 2025 is required. If no contributions were made for 2025, please report zero weeks and contributions." });
    h.given({ Weeks_PreviousYear: "0.00", LowContributions_PreviousYear: "0.00" }, noMdc()).expectFinding({ field: "PA_PreviousYear" });
    h.given(ZERO_PY, noMdc()).expectNoFinding();
    h.given({}, [stdMember()]).expectNoFinding();
    h.given({}, [stdMember({ emp: { permanencyDate: "2026-03-16" } }, [])]).expectNoFinding();
  });
});

describe("QA/L2: config enable flag and repeat-evaluation determinism", () => {
  it("enabled=false for B40 removes its findings while B41 keeps running", () => {
    const m = [stdMember({ emp: { salaryRates: [salaryRate(2025, 100000)] } })];
    const row: Partial<RawValues> = { ...ZERO_CY, AnnualizedEarnings_CurrentYear: "160000" };
    expect(l2(engine(row, m))).toEqual(expect.arrayContaining(["B40", "B41"]));
    const off = l2(engine(row, m, { overrides: [{ ruleId: "B40", key: "enabled", value: false }] }));
    expect(off).not.toContain("B40");
    expect(off).toContain("B41");
  });
  it("the same row against the same snapshot yields identical lake findings on repeated evaluation", () => {
    const m = [stdMember({ emp: { serviceBreaks: [brk("WSO", "2024-06-01")] } })];
    const a = engine({}, m).map(lakeFinding);
    const b = engine({}, m).map(lakeFinding);
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("QA/L2: carve-out trim/merge algorithm (spec IdentifiedBreaks, B184/B185/B186/B214) - union length under every overlap shape", () => {
  const win = { start: "2026-01-01" as IsoDate, endInclusive: "2026-12-31" as IsoDate, clipEnd: "2027-01-01" as IsoDate };
  const days = (breaks: ReturnType<typeof brk>[]) => carveOut(breaks, win, EXCESS_CARVE_TYPES).days;
  it("disjoint breaks add up; a non-carve type is ignored", () => {
    expect(days([brk("LTD", "2026-01-01", "2026-02-01"), brk("NCM", "2026-03-01", "2026-04-01")])).toBe(62);
    expect(days([brk("PAR", "2026-01-01", "2026-02-01")])).toBe(0);
  });
  it("nested and chained overlaps count each day once", () => {
    expect(days([brk("LTD", "2026-02-01", "2026-06-01"), brk("NCM", "2026-03-01", "2026-04-01")])).toBe(120);
    expect(days([brk("LTD", "2026-02-01", "2026-04-01"), brk("NCM", "2026-03-01", "2026-06-01")])).toBe(120);
    expect(days([brk("LTD", "2026-02-01", "2026-03-01"), brk("NCM", "2026-02-15", "2026-04-01"), brk("WSO", "2026-03-15", "2026-05-01")])).toBe(89);
  });
  it("a later break that starts before the window still de-overlaps against the clipped earlier one (both pairwise branches)", () => {
    expect(days([brk("LTD", "2025-12-01", "2026-03-01"), brk("NCM", "2025-12-15", "2026-02-01")])).toBe(59);
    expect(days([brk("LTD", "2025-12-01", "2026-01-15"), brk("NCM", "2025-12-15", "2026-03-01")])).toBe(59);
  });
  it("open-ended breaks are clipped at the exclusive window end; a break ending on the window start contributes nothing", () => {
    expect(days([brk("LTD", "2026-11-01", null)])).toBe(61);
    expect(days([brk("LTD", "2025-06-01", "2026-01-01")])).toBe(0);
    expect(days([brk("LTD", "2025-01-01", null)])).toBe(365);
  });
});
