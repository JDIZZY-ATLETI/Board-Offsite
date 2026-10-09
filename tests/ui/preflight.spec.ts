import { describe, expect, it } from "vitest";
import { closestColumn, preflightHeader } from "@/lib/ui/preflight";
import { EVENTS_CSV_COLUMNS } from "@/types";

const GOOD = EVENTS_CSV_COLUMNS.join(",");

describe("header pre-flight (section 5.2)", () => {
  it("accepts the exact 15-column header in any order", () => {
    const shuffled = [...EVENTS_CSV_COLUMNS].reverse().join(",");
    expect(preflightHeader(`${GOOD}\n1,2\n3,4\n`, true).state).toBe("ok");
    expect(preflightHeader(`${shuffled}\n`, true).state).toBe("ok");
  });

  it("counts data rows in a complete sample", () => {
    expect(preflightHeader(`${GOOD}\r\nrow\r\nrow\r\n\r\n`, true).rowCountSample).toBe(2);
  });

  it("warns when only optional columns are missing", () => {
    const h = EVENTS_CSV_COLUMNS.filter((c) => c !== "HighContributions_PreviousYear").join(",");
    const r = preflightHeader(`${h}\n`, true);
    expect(r.state).toBe("warn");
    expect(r.missingOptional).toEqual(["HighContributions_PreviousYear"]);
  });

  it("rejects unknown headers with a suggestion", () => {
    const h = GOOD.replace("Weeks_CurrentYear", "Weeks_CurrYear");
    const r = preflightHeader(`${h}\n`, true);
    expect(r.state).toBe("error");
    expect(r.unknown).toEqual(["Weeks_CurrYear"]);
    expect(r.suggestions.Weeks_CurrYear).toBe("Weeks_CurrentYear");
  });

  it("rejects duplicate headers and is case-sensitive like I51", () => {
    expect(preflightHeader(`${GOOD},SIN\n`, true).duplicates).toEqual(["SIN"]);
    expect(preflightHeader(`${GOOD.replace("SIN", "sin")}\n`, true).state).toBe("error");
  });

  it("flags an empty file and tolerates a BOM", () => {
    expect(preflightHeader("", true).state).toBe("empty");
    const r = preflightHeader(`\uFEFF${GOOD}\n`, true);
    expect(r.state).toBe("ok");
    expect(r.bom).toBe(true);
  });

  it("closestColumn ignores far-away names", () => {
    expect(closestColumn("Foo")).toBeNull();
    expect(closestColumn("PA_CurrentYr")).toBe("PA_CurrentYear");
  });
});