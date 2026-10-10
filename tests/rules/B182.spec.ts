import { describe, expect, it } from "vitest";
import { B182 } from "@/lib/rules/events/l2/B182";
import { contrib, stdMember, ZERO_CY } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B182);
const retro = () => stdMember({ emp: { contributions: [contrib(2025, "RPPLOW", 300, { indicator: "RETRO", paymentDate: "2026-04-15", summaryAttribute: "RRETRO" })] } });

describe("B182_RetroPaid / 9810 (INFORMATION, PRIVATE - always on)", () => {
  it("informs HOOPP when a PA is reported with zero service after a retro paid in the event year (M14)", () => {
    const f = h.given({ ...ZERO_CY, PA_CurrentYear: "3000" }, [retro()]).expectFinding({ messageId: "9810", yearScope: "CURRENT", params: { 0: 2026 }, dataImportMessage: "Retro Contributions have been previously reported as paid in 2026 and no service or contributions have been reported for 2026.  Please report a PA of 0.00 and HOOPP will contact you with the corrected PA for 2026.  " });
    expect(f.severity).toBe("INFORMATION");
    expect(f.visibility).toBe("PRIVATE");
    expect(B182.enabledByDefault).toBe(true);
  });
  it("blank high contributions count as zero; any reported weeks/low/high suppress it", () => {
    h.given({ ...ZERO_CY, HighContributions_CurrentYear: "", PA_CurrentYear: "3000" }, [retro()]).expectFinding();
    h.given({ ...ZERO_CY, HighContributions_CurrentYear: "0.01", PA_CurrentYear: "3000" }, [retro()]).expectNoFinding();
    h.given({ ...ZERO_CY, LowContributions_CurrentYear: "1.00", PA_CurrentYear: "3000" }, [retro()]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
