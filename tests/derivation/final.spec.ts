import { describe, expect, it } from "vitest";
import { contentHashOf, deriveFinal, itemsHash, mmddyyyy, sortItems } from "@/lib/derivation/final";
import type { ArielUpdateItemCore, IsoDate } from "@/types";
import { brk, contrib, ctsrv, cyBlock, employment, member, snapshotOf, SUMMARY_MDC } from "../helpers/ariel-fixtures";
import { rec } from "../helpers/rule-harness";

const EXEC: IsoDate = "2026-10-08";
const FINAL = "Final Data - Events";

function run(recOver: Parameters<typeof rec>[0], m = member(), opts: { employerId?: string; b139Overridden?: boolean } = {}) {
  const r = rec(recOver);
  const out = deriveFinal({ record: r, snapshot: snapshotOf([m]), employerId: opts.employerId ?? "0235", executionDate: EXEC, b139Overridden: opts.b139Overridden });
  if (!out) throw new Error("derivation returned null");
  return out;
}
const rules = (items: ArielUpdateItemCore[]) => items.map((i) => i.derivationRule);
const find = (items: ArielUpdateItemCore[], rule: string) => items.find((i) => i.derivationRule === rule)!;

describe("final derivation - employment (8.2)", () => {
  it("TERFIN: terminationDate/terminationCode TER/otherInformation/terminationDataUpdate in order, no Member item", () => {
    const { items } = run({ EmploymentEndDate: "09302026" });
    expect(rules(items).slice(0, 4)).toEqual(["D-EMP-TERMDATE", "D-EMP-TERMCODE", "D-EMP-OTHERINFO", "D-EMP-TERMDATAUPDATE"]);
    expect(find(items, "D-EMP-TERMDATE")).toMatchObject({ recordType: "Employment", operation: "UPDATE", fields: { terminationDate: "2026-09-30" }, before: { terminationDate: null }, sourceFields: ["EmploymentEndDate"] });
    expect(find(items, "D-EMP-TERMCODE").fields).toEqual({ terminationCode: "TER" });
    expect(find(items, "D-EMP-OTHERINFO").fields).toEqual({ otherInformation: "Events 09302026" });
    expect(find(items, "D-EMP-TERMDATAUPDATE").fields).toEqual({ terminationDataUpdate: EXEC });
    expect(items.some((i) => i.recordType === "Member")).toBe(false);
    expect(items.every((i) => i.targetKey.employmentId || i.targetKey.memberId)).toBe(true);
  });
  it("DECFIN: terminationCode DEC + Member.dateOfDeath from EmploymentEndDate (Q1) and otherInformation with the event date (Q12)", () => {
    const { items } = run({ EventType: "DECFIN", EmploymentEndDate: "07012026" });
    expect(find(items, "D-EMP-TERMCODE").fields).toEqual({ terminationCode: "DEC" });
    const dod = find(items, "D-MBR-DOD");
    expect(dod).toMatchObject({ recordType: "Member", operation: "UPDATE", fields: { dateOfDeath: "2026-07-01" }, before: { dateOfDeath: null } });
    expect(dod.explanation).toContain("Q1");
    expect(find(items, "D-EMP-OTHERINFO").fields.otherInformation).toBe("Events 07012026");
  });
  it("RETFIN: no terminationCode item (stays RET), terminationDate still updated", () => {
    const m = member({ emp: { terminationDate: "2026-06-30", terminationCode: "RET", otherInformation: "RetNotice 2026-06-30" } });
    const { items } = run({ EventType: "RETFIN", EmploymentEndDate: "06302026" }, m);
    expect(rules(items)).not.toContain("D-EMP-TERMCODE");
    expect(find(items, "D-EMP-TERMDATE")).toMatchObject({ fields: { terminationDate: "2026-06-30" }, before: { terminationDate: "2026-06-30" } });
    expect(find(items, "D-EMP-OTHERINFO").before).toEqual({ otherInformation: "RetNotice 2026-06-30" });
  });
  it("mmddyyyy renders the layout date format", () => {
    expect(mmddyyyy("2026-09-30")).toBe("09302026");
  });
});

describe("final derivation - D-NCT and calculation request (8.3 / 8.4)", () => {
  it("TERFIN closing the last open employment -> MembershipStatus D/NCT CREATE + CalculationsBenefit Termination", () => {
    const { items, membershipStatus } = run({ EmploymentEndDate: "09302026" });
    const st = find(items, "D-MSTAT-DNCT");
    expect(st).toMatchObject({ recordType: "MembershipStatus", operation: "CREATE", before: null, fields: { statusCode: "D", subStatusCode: "NCT", statusEffectiveDate: "2026-09-30", subStatusEffectiveDate: "2026-09-30" } });
    expect(st.calculated).toMatchObject({ previousStatus: "A", previousSubStatus: null });
    expect(membershipStatus).toEqual({ status: "D", subStatus: "NCT", effectiveDate: "2026-09-30" });
    const calc = find(items, "D-CALC-REQUEST");
    expect(calc.fields).toEqual({ eventCategory: "Termination", eventDate: "2026-09-30", finalCalculation: false, clientRequestDate: EXEC, estimate: false });
    expect(items.indexOf(st)).toBeLessThan(items.indexOf(calc));
  });
  it("DECFIN -> Death Before Retirement", () => {
    const { items } = run({ EventType: "DECFIN", EmploymentEndDate: "07012026" });
    expect(find(items, "D-CALC-REQUEST").fields.eventCategory).toBe("Death Before Retirement");
  });
  it("concurrent open employment at another employer -> no status, no calc request", () => {
    const m = member({ employments: [employment(), employment({ employerId: "0359" })] });
    const { items, membershipStatus } = run({ EmploymentEndDate: "09302026" }, m);
    expect(rules(items)).not.toContain("D-MSTAT-DNCT");
    expect(rules(items)).not.toContain("D-CALC-REQUEST");
    expect(membershipStatus).toBeNull();
  });
  it("Q17: another (closed) employment with a later termination date drives the status/calc event date", () => {
    const m = member({ employments: [employment(), employment({ employerId: "0359", terminationDate: "2026-11-30", terminationCode: "TER" })] });
    const { items } = run({ EmploymentEndDate: "09302026" }, m);
    expect(find(items, "D-MSTAT-DNCT").fields.statusEffectiveDate).toBe("2026-11-30");
    expect(find(items, "D-CALC-REQUEST").fields.eventDate).toBe("2026-11-30");
    expect(find(items, "D-EMP-TERMDATE").fields.terminationDate).toBe("2026-09-30");
  });
  it("RETFIN never creates status or calc request", () => {
    const m = member({ emp: { terminationDate: "2026-06-30", terminationCode: "RET" } });
    const { items } = run({ EventType: "RETFIN", EmploymentEndDate: "06302026" }, m);
    expect(rules(items).filter((r) => r === "D-MSTAT-DNCT" || r === "D-CALC-REQUEST")).toEqual([]);
  });
});

describe("final derivation - RETFIN flag / B139 (8.5 / 8.6)", () => {
  const retfin = { EventType: "RETFIN", EmploymentEndDate: "06302026" } as const;
  it("status P -> SET_FLAG BenefitReevaluationFlag (last item)", () => {
    const m = member({ membership: { status: "P" }, emp: { terminationDate: "2026-06-30", terminationCode: "RET" } });
    const { items, notes } = run(retfin, m);
    const last = items[items.length - 1];
    expect(last).toMatchObject({ recordType: "BenefitReevaluationFlag", operation: "SET_FLAG", derivationRule: "D-RET-REEVAL-ON", fields: { active: true } });
    expect(notes).toEqual([]);
  });
  it("status D-NCT -> no flag, INFO-RET-DNCT note", () => {
    const m = member({ membership: { status: "D", subStatus: "NCT" }, emp: { terminationDate: "2026-06-30", terminationCode: "RET" } });
    const { items, notes } = run(retfin, m);
    expect(rules(items)).not.toContain("D-RET-REEVAL-ON");
    expect(notes).toEqual([{ rule: "INFO-RET-DNCT", message: "Benefit re-evaluation flag not activated: member is D-NCT", params: { status: "D", subStatus: "NCT" } }]);
  });
  it("status A -> neither flag nor note", () => {
    const { items, notes } = run(retfin, member({ emp: { terminationDate: "2026-06-30", terminationCode: "RET" } }));
    expect(rules(items)).not.toContain("D-RET-REEVAL-ON");
    expect(notes).toEqual([]);
  });
  it("B139 overridden -> CalculationIndicator CHG_RET_EED with previous/new dates (Q13); not without override; not for TERFIN", () => {
    const m = member({ emp: { terminationDate: "2026-05-31", terminationCode: "RET" } });
    const withIt = run(retfin, m, { b139Overridden: true }).items;
    expect(find(withIt, "D-CALC-INDICATOR")).toMatchObject({ recordType: "CalculationIndicator", operation: "CREATE", fields: { code: "CHG_RET_EED", previousDate: "2026-05-31", newDate: "2026-06-30" } });
    expect(rules(run(retfin, m).items)).not.toContain("D-CALC-INDICATOR");
    expect(rules(run({ EmploymentEndDate: "06302026" }, member(), { b139Overridden: true }).items)).not.toContain("D-CALC-INDICATOR");
  });
});

describe("final derivation - service breaks (8.11)", () => {
  const breaks = [brk("DTO", "2026-01-10"), brk("NCS", "2026-05-01"), brk("NCM", "2026-11-01", "2026-12-15"), brk("NCP", "2026-02-01", "2026-04-30"), brk("LTD", "2025-01-01", "2026-10-01")];
  it("TERFIN: disability untouched, open break closed at event+1, start-after-event deleted, already-closed no-op, closed exactly at closeDate no-op", () => {
    const { items } = run({ EmploymentEndDate: "09302026" }, member({ emp: { serviceBreaks: breaks } }));
    const bi = items.filter((i) => i.recordType === "TransactionsServiceBreak");
    expect(bi.map((i) => [i.targetKey.type, i.operation])).toEqual([
      ["NCS", "CLOSE"],
      ["NCM", "DELETE"],
    ]);
    expect(bi[0]).toMatchObject({ derivationRule: "D-BRK-CLOSE", fields: { endDate: "2026-10-01" }, before: { endDate: null } });
    expect(bi[1]).toMatchObject({ derivationRule: "D-BRK-DELETE", fields: {}, before: { type: "NCM", startDate: "2026-11-01", endDate: "2026-12-15" } });
  });
  it("DECFIN closes disability breaks like any other (Q16)", () => {
    const { items } = run({ EventType: "DECFIN", EmploymentEndDate: "09302026" }, member({ emp: { serviceBreaks: breaks } }));
    const bi = items.filter((i) => i.recordType === "TransactionsServiceBreak");
    expect(bi.map((i) => [i.targetKey.type, i.operation])).toEqual([
      ["DTO", "CLOSE"],
      ["NCS", "CLOSE"],
      ["NCM", "DELETE"],
    ]);
  });
  it("a break ending after closeDate is CLOSED (end pulled back), one ending before is left alone", () => {
    const { items } = run({ EmploymentEndDate: "09302026" }, member({ emp: { serviceBreaks: [brk("NCS", "2026-05-01", "2026-12-31"), brk("NCS", "2026-03-01", "2026-09-15")] } }));
    const bi = items.filter((i) => i.recordType === "TransactionsServiceBreak");
    expect(bi).toHaveLength(1);
    expect(bi[0]).toMatchObject({ operation: "CLOSE", before: { endDate: "2026-12-31" }, fields: { endDate: "2026-10-01" } });
  });
});

describe("final derivation - transactions (8.7 - 8.10)", () => {
  it("CTSRV / RPPLOW / RPPHGH CREATE with Default Values dates when Ariel has no same-key rows; PY items only when PY fields present", () => {
    const { items } = run({ EmploymentEndDate: "09302026", Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: "1950.25", HighContributions_CurrentYear: "320.50", PA_CurrentYear: "8450", Weeks_PreviousYear: "52.00", LowContributions_PreviousYear: "2700.00", HighContributions_PreviousYear: "", PA_PreviousYear: "" });
    const svc = find(items, "D-SRV-CTSRV-CY");
    expect(svc).toMatchObject({ recordType: "TransactionsService", operation: "CREATE", yearScope: "CURRENT", fields: { type: "CTSRV", amount: "38.00", beginDate: "2026-01-01", endDate: "2026-09-30", paymentDate: "2026-09-30", targetDate: "2026-09-30", declarationDate: "2026-09-30", transactionIndicator: "PRV", numberOfPays: 2026, summaryAttributes: FINAL } });
    expect(svc.targetKey).toEqual({ employmentId: expect.any(String), type: "CTSRV", indicator: "PRV", summaryAttributes: FINAL, beginDate: "2026-01-01", endDate: "2026-09-30", paymentDate: "2026-09-30", targetDate: "2026-09-30" });
    expect(find(items, "D-SRV-CTSRV-PY").fields).toMatchObject({ amount: "52.00", beginDate: "2025-01-01", endDate: "2025-12-31", paymentDate: "2025-12-31", targetDate: "2025-12-31", declarationDate: "2025-12-31", numberOfPays: 2025 });
    expect(find(items, "D-CONTRIB-RPPLOW-PRV-CY").fields).toMatchObject({ type: "RPPLOW", amount: "1950.25", transactionIndicator: "PRV" });
    expect(find(items, "D-CONTRIB-RPPHGH-PRV-CY").fields).toMatchObject({ type: "RPPHGH", amount: "320.50" });
    expect(find(items, "D-CONTRIB-RPPLOW-PRV-PY").fields).toMatchObject({ amount: "2700.00", beginDate: "2025-01-01" });
    expect(rules(items)).not.toContain("D-CONTRIB-RPPHGH-PRV-PY");
    expect(rules(items)).not.toContain("D-CONTRIB-RPPHGH-CLC-PY");
    expect(find(items, "D-PA-CY")).toMatchObject({ recordType: "PlansTaxInfoPA", operation: "CREATE", fields: { pensionAdjustment: 8450, calculationYear: 2026, inputDate: EXEC, employerId: "0235" } });
    expect(rules(items)).not.toContain("D-PA-PY");
  });
  it("UPSERT_ADD when Ariel already holds a same-key Final Data transaction: before.amount + file = fields.amount", () => {
    const existing = ctsrv(2026, "5.0000", { beginDate: "2026-01-01", endDate: "2026-09-30", paymentDate: "2026-09-30", targetDate: "2026-09-30", summaryAttribute: FINAL });
    const low = contrib(2026, "RPPLOW", "1200.00", { beginDate: "2026-01-01", endDate: "2026-09-30", paymentDate: "2026-09-30", targetDate: "2026-09-30", summaryAttribute: FINAL });
    const { items } = run({ EmploymentEndDate: "09302026", Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: "523.64", HighContributions_CurrentYear: "", PA_CurrentYear: "12594" }, member({ emp: { service: [existing], contributions: [low] } }));
    const svc = find(items, "D-SRV-CTSRV-CY");
    expect(svc).toMatchObject({ operation: "UPSERT_ADD", before: { amount: "5.00", txIds: existing.txId }, fields: { amount: "43.00" }, calculated: { existingAmount: "5.00", fileAmount: "38.00", resultAmount: "43.00" } });
    expect(find(items, "D-CONTRIB-RPPLOW-PRV-CY")).toMatchObject({ operation: "UPSERT_ADD", before: { amount: "1200.00" }, fields: { amount: "1723.64" } });
    // MDC rows (different summary attribute) never match
    const { items: i2 } = run({ EmploymentEndDate: "09302026", Weeks_CurrentYear: "38.00" }, member({ emp: { service: [ctsrv(2026, 52, { summaryAttribute: SUMMARY_MDC })] } }));
    expect(find(i2, "D-SRV-CTSRV-CY").operation).toBe("CREATE");
  });
  it("Weeks = 0 creates no CTSRV item; PA = 0 is recorded; AE > 0 creates a REPORT salary rate at MAX(Jan 1, permanency)", () => {
    const m = member({ emp: { permanencyDate: "2026-03-16" } });
    const { items } = run({ EmploymentEndDate: "09302026", Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00", HighContributions_CurrentYear: "", AnnualizedEarnings_CurrentYear: "53000", PA_CurrentYear: "0" }, m);
    expect(rules(items)).not.toContain("D-SRV-CTSRV-CY");
    expect(find(items, "D-CONTRIB-RPPLOW-PRV-CY").fields.amount).toBe("0.00");
    expect(find(items, "D-PA-CY").fields.pensionAdjustment).toBe(0);
    expect(find(items, "D-SALRATE-CY")).toMatchObject({ recordType: "TransactionsSalaryRates", operation: "CREATE", fields: { salaryRateType: "REPORT", rate: "53000.00", effectiveDate: "2026-03-16", entryDate: EXEC, transactionIndicator: "Provided", numberOfPays: 2026, summaryAttributes: FINAL } });
    expect(find(items, "D-CONTRIB-RPPLOW-PRV-CY").fields.beginDate).toBe("2026-03-16");
  });
  it("CLC split: created only with High + effective PA; CY before PY; RPPHGH CLC then RCAHGH CLC with formula inputs in `calculated`", () => {
    const high = contrib(2026, "RPPHGH", "5000.00", { paymentDate: "2026-06-30" });
    const low = contrib(2026, "RPPLOW", "6000.00", { paymentDate: "2026-06-30" });
    const prior = contrib(2026, "RPPHGH", "-150.00", { indicator: "CLC", paymentDate: "2026-06-30" });
    const { items, contributionSplits } = run({ EmploymentEndDate: "09302026", LowContributions_CurrentYear: "1000.00", HighContributions_CurrentYear: "900.00", PA_CurrentYear: "10000" }, member({ emp: { contributions: [high, low, prior] } }));
    const rpp = find(items, "D-CONTRIB-RPPHGH-CLC-CY");
    const rca = find(items, "D-CONTRIB-RCAHGH-CLC-CY");
    expect(rpp).toMatchObject({ recordType: "TransactionsContributions", operation: "CREATE", fields: { type: "RPPHGH", transactionIndicator: "CLC", amount: "-4750.00" }, sourceFields: ["HighContributions_CurrentYear", "LowContributions_CurrentYear", "PA_CurrentYear"] });
    expect(rca.fields).toMatchObject({ type: "RCAHGH", transactionIndicator: "CLC", amount: "5050.00" });
    expect(rpp.calculated).toMatchObject({ pool: "12900.00", limit: "8000.00", excess: "4900.00", priorClc: "-150.00", paEffective: 10000, paSource: "file", result: "-4750.00" });
    expect(rpp.explanation).toContain("Pool = 6000.00 (Ariel RPPLOW PRV 2026) + 5000.00 (Ariel RPPHGH PRV 2026)");
    expect(contributionSplits.CURRENT?.rcahghClc).toBe("5050.00");
    const order = rules(items);
    expect(order.indexOf("D-CONTRIB-RPPLOW-PRV-CY")).toBeLessThan(order.indexOf("D-CONTRIB-RPPHGH-PRV-CY"));
    expect(order.indexOf("D-CONTRIB-RPPHGH-PRV-CY")).toBeLessThan(order.indexOf("D-CONTRIB-RPPHGH-CLC-CY"));
    expect(order.indexOf("D-CONTRIB-RPPHGH-CLC-CY")).toBeLessThan(order.indexOf("D-CONTRIB-RCAHGH-CLC-CY"));
  });
  it("CLC: zero excess and no prior CLC -> no CLC items; file PA 0 -> Ariel PA (sourceFields exclude PA column); no PA -> no CLC", () => {
    const m = member({ pensionAdjustments: [{ paId: "pa-1", employerId: "0235", calculationYear: 2026, amount: 9000, calculationDate: "2026-12-31", entryDate: "2026-01-15" }] });
    const zero = run({ EmploymentEndDate: "09302026", LowContributions_CurrentYear: "100.00", HighContributions_CurrentYear: "50.00", PA_CurrentYear: "9000" }).items;
    expect(rules(zero).some((r) => r.includes("-CLC-"))).toBe(false);
    const fallback = run({ EmploymentEndDate: "09302026", LowContributions_CurrentYear: "9000.00", HighContributions_CurrentYear: "5000.00", PA_CurrentYear: "0" }, m).items;
    const clc = find(fallback, "D-CONTRIB-RPPHGH-CLC-CY");
    expect(clc.calculated).toMatchObject({ paSource: "ariel", paEffective: 9000, limit: "7300.00" });
    expect(clc.sourceFields).toEqual(["HighContributions_CurrentYear", "LowContributions_CurrentYear"]);
    const none = run({ EmploymentEndDate: "09302026", LowContributions_CurrentYear: "9000.00", HighContributions_CurrentYear: "5000.00", PA_CurrentYear: "0" }).items;
    expect(rules(none).some((r) => r.includes("-CLC-"))).toBe(false);
  });
  it("Ariel sums are by year of payment date (R16) and only on the matched employment", () => {
    const paid2025 = contrib(2026, "RPPHGH", "9999.00", { paymentDate: "2025-12-31" });
    const other = employment({ employerId: "0359", contributions: [contrib(2026, "RPPHGH", "9999.00", { paymentDate: "2026-05-01" })] });
    const { contributionSplits } = run({ EmploymentEndDate: "09302026", LowContributions_CurrentYear: "100.00", HighContributions_CurrentYear: "50.00", PA_CurrentYear: "100" }, member({ employments: [employment({ contributions: [paid2025] }), other] }));
    expect(contributionSplits.CURRENT?.terms.arielHighPrv).toBe("0.00");
  });
});

describe("final derivation - ordering, hashing, null cases (8.13)", () => {
  it("section 8.13 record-type order is respected", () => {
    const m = member({ membership: { status: "A" }, emp: { serviceBreaks: [brk("NCS", "2026-05-01")], contributions: [contrib(2026, "RPPHGH", "9000.00", { paymentDate: "2026-05-01" })] } });
    const { items } = run({ ...cyBlock("2026-09-30", 38, 90000), AnnualizedEarnings_CurrentYear: "90000", HighContributions_CurrentYear: "2000.00", PA_CurrentYear: "3000" }, m);
    const types = [...new Set(items.map((i) => i.recordType))];
    expect(types).toEqual(["Employment", "TransactionsServiceBreak", "TransactionsService", "TransactionsContributions", "TransactionsSalaryRates", "PlansTaxInfoPA", "MembershipStatus", "CalculationsBenefit"]);
    expect(items.map((i) => i.sortOrder)).toEqual(items.map((_, i) => i));
  });
  it("itemsHash / contentHashOf are stable across item order and across identical runs", () => {
    const m = member();
    const a = run({ EmploymentEndDate: "09302026" }, m).items;
    const b = run({ EmploymentEndDate: "09302026" }, m).items;
    expect(itemsHash(a)).toBe(itemsHash(b));
    expect(itemsHash([...a].reverse())).toBe(itemsHash(a));
    expect(contentHashOf([...a, ...b].reverse())).toBe(contentHashOf([...a, ...b]));
    expect(contentHashOf(a)).not.toBe(contentHashOf(run({ EmploymentEndDate: "09292026" }, m).items));
    expect(sortItems([...a].reverse()).map((i) => i.sortOrder)).toEqual(a.map((i) => i.sortOrder));
  });
  it("memberDisplay is masked SIN + file names; no raw SIN anywhere in the items", () => {
    const { items } = run({ EmploymentEndDate: "09302026", LastName: "ABLE", FirstName: "Anna" });
    expect(items[0].memberDisplay).toBe("***-***-019 ABLE, Anna");
    expect(JSON.stringify(items)).not.toContain("900000019");
  });
  it("returns null for an unknown member or a member without employment at the employer", () => {
    const r = rec({ EmploymentEndDate: "09302026" });
    expect(deriveFinal({ record: r, snapshot: snapshotOf([]), employerId: "0235", executionDate: EXEC })).toBeNull();
    expect(deriveFinal({ record: r, snapshot: snapshotOf([member()]), employerId: "0359", executionDate: EXEC })).toBeNull();
  });
});