import { describe, expect, it } from "vitest";
import { B181 } from "@/lib/rules/events/l2/B181";
import { contrib, stdMember, ZERO_CY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B181);
const retro = (paymentYear = 2026) => stdMember({ emp: { contributions: [contrib(2025, "RPPLOW", 300, { indicator: "RETRO", paymentDate: `${paymentYear}-04-15`, summaryAttribute: "RRETRO" })] } });

describe("B181_RetroPaid / 6700 (CME, shipped disabled - section 18 Q21)", () => {
  it("is disabled by default but evaluates when switched on: PA with zero service/contributions after a retro paid in the event year", () => {
    expect(B181.enabledByDefault).toBe(false);
    h.given({ ...ZERO_CY, PA_CurrentYear: "3000" }, [retro()]).expectFinding({ messageId: "6700", yearScope: "CURRENT", field: "PA_CurrentYear", params: { 0: 2026 }, calculated: { retroPaymentDate: "2026-04-15", retroAmount: "300.00", reportedPA: 3000 } });
  });
  it("does not fire with service reported, a zero PA, or a retro paid in another year", () => {
    h.given({ PA_CurrentYear: "3000" }, [retro()]).expectNoFinding();
    h.given({ ...ZERO_CY, PA_CurrentYear: "0" }, [retro()]).expectNoFinding();
    h.given({ ...ZERO_CY, PA_CurrentYear: "3000" }, [retro(2025)]).expectNoFinding();
    h.given({ ...ZERO_CY, PA_CurrentYear: "3000" }).expectNoFinding();
  });
});
