import { describe, it } from "vitest";
import { B224 } from "@/lib/rules/events/l2/B224";
import { employment, member } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B224);

describe("B224_ / 3001", () => {
  it("rejects two concurrent active employments at the reporting employer", () => {
    const m = member({ employments: [employment({ employmentId: "emp-a" }), employment({ employmentId: "emp-b", permanencyDate: "2024-02-05" })] });
    h.given({}, [m]).expectFinding({ messageId: "3001", calculated: { employments: "emp-a,emp-b" }, dataImportMessage: "Member is already enrolled with HOOPP at your organization." });
  });
  it("accepts when the earlier employment is terminated, or the second one is at another employer", () => {
    h.given({}, [member({ employments: [employment({ employmentId: "emp-a", terminationDate: "2023-12-31", terminationCode: "TER" }), employment({ employmentId: "emp-b", permanencyDate: "2024-02-05" })] })]).expectNoFinding();
    h.given({}, [member({ employments: [employment({ employmentId: "emp-a" }), employment({ employmentId: "emp-b", employerId: "0359", permanencyDate: "2024-02-05" })] })]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
