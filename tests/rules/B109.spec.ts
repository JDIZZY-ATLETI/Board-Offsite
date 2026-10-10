import { describe, it } from "vitest";
import { B109 } from "@/lib/rules/events/l2/B109";
import { cyBlock, stdMember } from "../helpers/ariel-fixtures";
import { l2Harness } from "../helpers/rule-harness";

const h = l2Harness(B109);
const late = () => stdMember({ emp: { permanencyDate: "2026-05-01" } }, []);

describe("B109_EventDate_Before_PermanencyDate / 7476", () => {
  it("rejects an event date before the enrolment date", () => {
    h.given(cyBlock("2026-03-31", 12, 70000), [late()]).expectFinding({ messageId: "7476", field: "EmploymentEndDate", calculated: { eventDate: "2026-03-31", permanencyDate: "2026-05-01" }, dataImportMessage: "Event date must be after the member\u2019s Enrolment Date." });
  });
  it("points at DateOfDeath for a DECFIN row that carries one", () => {
    h.given({ EventType: "DECFIN", EmploymentEndDate: "", DateOfDeath: "03312026" } as never, [late()]).expectFinding({ field: "DateOfDeath" });
  });
  it("accepts an event on or after the enrolment date", () => {
    h.given(cyBlock("2026-05-01", 1, 70000), [late()]).expectNoFinding();
    h.given().expectNoFinding();
  });
});
