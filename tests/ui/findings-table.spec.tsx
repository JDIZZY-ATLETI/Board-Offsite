// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationFinding } from "@/types";

const replace = vi.fn();
let search = new URLSearchParams();
const router = { replace, push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/batches/b1/findings",
  useSearchParams: () => search,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { defaultGroupMode, FindingsView } from "@/components/app/findings/findings-table";

function f(partial: Partial<ValidationFinding> & Pick<ValidationFinding, "findingId" | "ruleId" | "severity">): ValidationFinding {
  return {
    batchId: "b1",
    recordId: null,
    lineNumber: 12,
    sinPseudo: null,
    messageId: "7854",
    level: "L1",
    visibility: "PUBLIC",
    field: "Weeks_CurrentYear",
    yearScope: "CURRENT",
    params: {},
    dataImportMessage: "DI",
    portalMessage: `Portal ${partial.ruleId}`,
    overrideReasons: [],
    createdAt: "2026-10-08T00:00:00.000Z",
    sortOrder: 0,
    ...partial,
  };
}

const findings = [
  f({ findingId: "1", ruleId: "I5", severity: "COMPLETE_MEMBER_ERROR", lineNumber: 12 }),
  f({ findingId: "2", ruleId: "I7", severity: "COMPLETE_MEMBER_ERROR", lineNumber: 12 }),
  f({ findingId: "3", ruleId: "I32", severity: "COMPLETE_MEMBER_ERROR", lineNumber: 57 }),
  f({ findingId: "4", ruleId: "B40", severity: "WARNING", lineNumber: 73 }),
];
const records = {
  12: { lineNumber: 12, sinMasked: "***-***-563", firstName: "Anna", lastName: "Able", eventType: "TERFIN", eventDate: "2026-09-30" },
  57: { lineNumber: 57, sinMasked: "***-***-118", firstName: "Ben", lastName: "Baker", eventType: "DECFIN", eventDate: "2026-08-14" },
  73: { lineNumber: 73, sinMasked: "***-***-902", firstName: "Cy", lastName: "Chen", eventType: "RETFIN", eventDate: "2026-06-30" },
};
const facets = { bySeverity: [{ value: "COMPLETE_MEMBER_ERROR" as const, count: 3 }, { value: "WARNING" as const, count: 1 }], byRule: [{ value: "I5", count: 1 }], byField: [{ value: "Weeks_CurrentYear", count: 4 }], total: 4 };

function renderView(role: "EmployerSubmitter" | "Reviewer" | "Admin") {
  return render(
    <TooltipProvider>
      <FindingsView batchId="b1" findings={findings} records={records} facets={facets} role={role} nextCursor={null} prevCursors={[]} rejectedRows={2} fileRejected={false} canSeePrivate={role !== "EmployerSubmitter"} />
    </TooltipProvider>,
  );
}

describe("FindingsView grouping (D1)", () => {
  beforeEach(() => {
    search = new URLSearchParams();
    replace.mockClear();
  });

  it("defaults: Submitter by row, Reviewer by severity", () => {
    expect(defaultGroupMode("EmployerSubmitter")).toBe("row");
    expect(defaultGroupMode("Reviewer")).toBe("severity");
    expect(defaultGroupMode("Admin")).toBe("severity");
  });

  it("row mode renders one group per row with member facts and finding cards", () => {
    renderView("EmployerSubmitter");
    const list = screen.getByRole("list", { name: "Findings grouped by row" });
    expect(list.querySelectorAll(":scope > li")).toHaveLength(3);
    expect(screen.getByText("Row 12")).toBeInTheDocument();
    expect(screen.getByText("ABLE, Anna")).toBeInTheDocument();
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByTestId("finding-card-1")).toBeInTheDocument();
    expect(screen.queryByText("Show HOOPP-internal findings")).toBeNull();
  });

  it("severity mode renders a table grouped by severity", () => {
    renderView("Reviewer");
    expect(screen.getByTestId("findings-table")).toBeInTheDocument();
    expect(screen.getAllByRole("rowgroup").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("severity-badge-COMPLETE_MEMBER_ERROR").some((el) => el.textContent?.includes("· 3"))).toBe(true);
    expect(screen.getByText("Show HOOPP-internal findings")).toBeInTheDocument();
  });

  it("rule mode groups by rule id via the URL", () => {
    search = new URLSearchParams("group=rule");
    renderView("Reviewer");
    const headers = screen.getAllByRole("rowgroup").map((h) => h.textContent);
    expect(headers.some((h) => h?.includes("I5"))).toBe(true);
    expect(headers.some((h) => h?.includes("B40"))).toBe(true);
  });

  it("switching group mode writes to the URL", () => {
    renderView("Reviewer");
    screen.getByRole("radio", { name: "Row" }).click();
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("group=row"), expect.anything());
  });

  it("offers the rejected-rows download only when rows were rejected", () => {
    renderView("EmployerSubmitter");
    expect(screen.getByTestId("download-rejected-button")).toBeInTheDocument();
  });
});