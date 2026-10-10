import { describe, it } from "vitest";
import { B206 } from "@/lib/rules/events/l2/B206";
import { employment, mdcHistory, member, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B206);
const history = (date: `${number}-${number}-${number}`) => [{ status: "A", subStatus: null, effectiveDate: "2015-03-02" as const }, { status: "A", subStatus: "RHR", effectiveDate: date }];

describe("B206_UnicityStatusDeleteEffectiveDate / 619", () => {
  it("TERFIN closing the last open employment derives D/NCT at the event date; an existing status on that date collides", () => {
    h.given({}, [stdMember({ membership: { statusHistory: history("2026-09-30") } })]).expectFinding({ messageId: "619", calculated: { effectiveDate: "2026-09-30", existingStatus: "A", existingSubStatus: "RHR" }, dataImportMessage: "There is an issue regarding the membership status effective date for this member. Please contact HOOPP for more information." });
    h.given({ EventType: "DECFIN" }, [stdMember({ membership: { statusHistory: history("2026-09-30") } })]).expectFinding();
  });
  it("section 18 Q17: with a concurrent employment terminated later, the status date is that later date", () => {
    const hist = mdcHistory();
    const m = member({ membership: { statusHistory: history("2026-11-30") }, employments: [employment({ employmentId: "e1", service: hist.service, contributions: hist.contributions }), employment({ employmentId: "e2", employerId: "0359", permanencyDate: "2020-01-06", terminationDate: "2026-11-30", terminationCode: "TER" })] });
    h.given({}, [m]).expectFinding({ calculated: { effectiveDate: "2026-11-30" } });
  });
  it("no derived status (RETFIN, or another employment still open) or a different date -> clean", () => {
    h.given({ EventType: "RETFIN" }, [stdMember({ membership: { statusHistory: history("2026-09-30") } })]).expectNoFinding();
    h.given({}, [stdMember({ membership: { statusHistory: history("2026-09-29") } })]).expectNoFinding();
    const hist = mdcHistory();
    h.given({}, [member({ membership: { statusHistory: history("2026-09-30") }, employments: [employment({ employmentId: "e1", service: hist.service, contributions: hist.contributions }), employment({ employmentId: "e2", employerId: "0359", permanencyDate: "2020-01-06" })] })]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
