import { describe, expect, it } from "vitest";
import { computeContributionSplit, effectivePa, RPP_LIMIT_BASE, RPP_LIMIT_PA_FACTOR, type ContributionSplitInput } from "@/lib/derivation/final/contributionSplit";

/** Architecture section 8.8 / 15 "contribution split worked examples" (5 mandatory cases) + Q14/Q15 edges. */
const base: ContributionSplitInput = {
  year: 2026,
  arielLowPrv: "1200.00",
  arielHighPrv: "800.00",
  arielLowRetro: "0.00",
  arielHighRetro: "0.00",
  fileLow: "523.64",
  fileHigh: "321.23",
  filePa: 12594,
  arielPa: null,
  priorRpphghClc: "0.00",
};

describe("contribution split - worked examples", () => {
  it("1. zero excess: pool below the RPP limit, no prior CLC -> amounts 0.00 and nothing to emit", () => {
    const r = computeContributionSplit(base)!;
    expect(r.pool).toBe("2844.87");
    expect(r.limit).toBe("9815.80");
    expect(r.excess).toBe("0.00");
    expect(r.rpphghClc).toBe("0.00");
    expect(r.rcahghClc).toBe("0.00");
    expect(r.emit).toBe(false);
    expect(r.paSource).toBe("file");
  });
  it("2. positive excess: RPP CLC is the negative excess, RCA CLC the positive mirror (Q15 literal)", () => {
    const r = computeContributionSplit({ ...base, arielLowPrv: "6000.00", arielHighPrv: "5000.00", fileLow: "1000.00", fileHigh: "900.00", filePa: 10000 })!;
    // pool 12900, limit 1000 + 7000 = 8000, excess 4900
    expect(r.pool).toBe("12900.00");
    expect(r.limit).toBe("8000.00");
    expect(r.excess).toBe("4900.00");
    expect(r.rpphghClc).toBe("-4900.00");
    expect(r.rcahghClc).toBe("4900.00");
    expect(r.emit).toBe(true);
    expect(r.explanationRpp).toContain("RPPHGH_CLC = -4900.00 - (0.00) = -4900.00");
  });
  it("3. prior CLC present: both amounts are net of the already-posted RPPHGH CLC (idempotent re-load)", () => {
    const r = computeContributionSplit({ ...base, priorRpphghClc: "-150.00" })!;
    expect(r.excess).toBe("0.00");
    expect(r.rpphghClc).toBe("150.00");
    expect(r.rcahghClc).toBe("150.00");
    expect(r.emit).toBe(true);
    const r2 = computeContributionSplit({ ...base, arielLowPrv: "6000.00", arielHighPrv: "5000.00", fileLow: "1000.00", fileHigh: "900.00", filePa: 10000, priorRpphghClc: "-4900.00" })!;
    expect(r2.rpphghClc).toBe("0.00");
    expect(r2.rcahghClc).toBe("9800.00");
  });
  it("4. file PA = 0 falls back to the Ariel PA for the year (Q14 point 3)", () => {
    const r = computeContributionSplit({ ...base, filePa: 0, arielPa: 5000, arielLowPrv: "6000.00", arielHighPrv: "5000.00" })!;
    expect(r.paSource).toBe("ariel");
    expect(r.paEffective).toBe(5000);
    expect(r.limit).toBe("4500.00");
    expect(r.excess).toBe("7344.87");
    expect(r.rpphghClc).toBe("-7344.87");
    expect(r.rcahghClc).toBe("7344.87");
  });
  it("5. no PA anywhere -> no CLC calculated at all (null), even with a large pool", () => {
    expect(computeContributionSplit({ ...base, filePa: 0, arielPa: null, arielLowPrv: "60000.00" })).toBeNull();
    expect(computeContributionSplit({ ...base, filePa: null, arielPa: null })).toBeNull();
  });
});

describe("contribution split - edges", () => {
  it("retro rows (by payment year) enter the pool", () => {
    const r = computeContributionSplit({ ...base, arielLowRetro: "100.00", arielHighRetro: "50.00" })!;
    expect(r.pool).toBe("2994.87");
    expect(r.terms.arielLowRetro).toBe("100.00");
  });
  it("Ariel PA of 0 is a real PA (limit = 1000) when the file says 0", () => {
    const r = computeContributionSplit({ ...base, filePa: 0, arielPa: 0 })!;
    expect(r.paSource).toBe("ariel");
    expect(r.limit).toBe("1000.00");
    expect(r.excess).toBe("1844.87");
  });
  it("effectivePa prefers a non-zero file PA, then Ariel, else null", () => {
    expect(effectivePa(12, 99)).toEqual({ value: 12, source: "file" });
    expect(effectivePa(0, 99)).toEqual({ value: 99, source: "ariel" });
    expect(effectivePa(null, 99)).toEqual({ value: 99, source: "ariel" });
    expect(effectivePa(0, null)).toBeNull();
  });
  it("constants are the spec literals 1000 and 0.7", () => {
    expect(RPP_LIMIT_BASE.toString()).toBe("1000");
    expect(RPP_LIMIT_PA_FACTOR.toString()).toBe("0.7");
  });
  it("is exact on cents (decimal arithmetic, 2 dp strings)", () => {
    const r = computeContributionSplit({ ...base, arielLowPrv: "0.10", arielHighPrv: "0.20", fileLow: "0.30", fileHigh: "0.40", filePa: 0, arielPa: 0 })!;
    expect(r.pool).toBe("1.00");
    expect(r.excess).toBe("0.00");
  });
});