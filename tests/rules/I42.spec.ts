import { describe, it } from "vitest";
import { I42 } from "@/lib/rules/events/l2/I42";
import { ctxOf, rec, ruleHarness } from "../helpers/rule-harness";

const h = ruleHarness(I42);

describe("I42_FutureDate / 8106", () => {
  it("rejects TERFIN with EmploymentEndDate after the execution date", () => {
    h.given(rec({ EmploymentEndDate: "10092026" }), ctxOf({ executionDate: "2026-10-08" })).expectFinding({ messageId: "8106", field: "EmploymentEndDate", dataImportMessage: "Event date must be earlier than or equal to today's date.", portalMessage: "Event date must be earlier than or equal to today's date.", calculated: { eventDate: "2026-10-09", executionDate: "2026-10-08" } });
  });
  it("rejects DECFIN with a future death date (CSV fallback to EmploymentEndDate)", () => {
    h.given(rec({ EventType: "DECFIN", EmploymentEndDate: "11302026" })).expectFinding({ field: "EmploymentEndDate" });
    h.given(rec({ EventType: "DECFIN", EmploymentEndDate: "", DateOfDeath: "11302026" } as never)).expectFinding({ field: "DateOfDeath" });
  });
  it("applies to RETFIN by default (Q5) and can be switched off", () => {
    h.given(rec({ EventType: "RETFIN", EmploymentEndDate: "01012027" })).expectFinding();
    h.given(rec({ EventType: "RETFIN", EmploymentEndDate: "01012027" }), ctxOf({ i42ApplyToRetfin: false })).expectNoFinding();
  });
  it("accepts dates on or before the execution date and skips unparseable dates", () => {
    h.given(rec({ EmploymentEndDate: "10082026" }), ctxOf({ executionDate: "2026-10-08" })).expectNoFinding();
    h.given(rec({ EmploymentEndDate: "09302026" })).expectNoFinding();
    h.given(rec({ EmploymentEndDate: "99999999" })).expectNoFinding();
  });
});
