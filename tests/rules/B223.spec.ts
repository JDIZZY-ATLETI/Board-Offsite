import { describe, it } from "vitest";
import { B223 } from "@/lib/rules/events/l2/B223";
import { cyBlock, employment, member, pyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B223);
const nhh = (ind: string) => stdMember({ membership: { calculationIndicators: [ind] }, emp: { permanencyDate: "2010-02-01" } }, [{ year: 2017, ae: 60000 }]);

describe("B223_NHH_MEMBER / 2953", () => {
  it("rejects an NHH member whose derived transactions target a date before the merger (NHHSTM = 2019-07-01)", () => {
    h.given(cyBlock("2019-03-31", 12, 60000), [nhh("NHHSTM")]).expectFinding({ messageId: "2953", calculated: { indicator: "NHHSTM", mergerEffectiveDate: "2019-07-01", targetDate: "2019-03-31", transaction: "CTSRV" }, dataImportMessage: "This event cannot be submitted via HOOPP Insight. Please contact HOOPP for assistance." });
  });
  it("previous-year items count too (event after the merger, previous year before it)", () => {
    h.given({ ...cyBlock("2019-10-15", 41, 63000), ...pyBlock(2018, 52, 62000) }, [nhh("NHHGR")]).expectFinding({ calculated: { indicator: "NHHGR", targetDate: "2018-12-31" } });
  });
  it("accepts when every target date is on/after the merger, or the member has no configured NHH indicator", () => {
    h.given({}, [nhh("NHHSTM")]).expectNoFinding();
    h.given(cyBlock("2019-03-31", 12, 60000), [stdMember()]).expectNoFinding();
    h.given(cyBlock("2018-12-15", 49, 60000), [stdMember({ membership: { calculationIndicators: ["NHHSIS"] } })]).expectFinding({ calculated: { mergerEffectiveDate: "2019-01-01" } });
    h.given(cyBlock("2019-03-31", 12, 60000), [stdMember({ membership: { calculationIndicators: ["NHHSIS"] } })]).expectNoFinding();
    h.given(cyBlock("2019-03-31", 12, 60000), [stdMember({ membership: { calculationIndicators: ["OTHER"] } })]).expectNoFinding();
  });
  it("only applies to the configured NHH employers", () => {
    const m = member({ membership: { calculationIndicators: ["NHHSTM"] }, employments: [employment({ employerId: "0001", permanencyDate: "2010-02-01" })] });
    h.given(cyBlock("2019-03-31", 12, 60000), [m], { employerId: "0001" }).expectNoFinding();
  });
});
