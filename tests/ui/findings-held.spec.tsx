// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationFinding } from "@/types";

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/batches/b1/findings",
  useSearchParams: () => search,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { FindingsView, overrideBlockedReason, SUBMITTER_OVERRIDE_COPY, type FindingsRecord } from "@/components/app/findings/findings-table";
import { OverrideStrip } from "@/components/app/findings/finding-card";

function f(partial: Partial<ValidationFinding> & Pick<ValidationFinding, "findingId" | "ruleId" | "severity" | "lineNumber">): ValidationFinding {
  return {
    batchId: "b1",
    recordId: `r${partial.lineNumber}`,
    sinPseudo: null,
    messageId: "7854",
    level: "L2",
    visibility: "PUBLIC",
    field: "AnnualizedEarnings_CurrentYear",
    yearScope: "CURRENT",
    params: {},
    dataImportMessage: "DI",
    portalMessage: `Portal ${partial.ruleId}`,
    overrideReasons: ["The member received a promotion", "Other - please provide explanation"],
    createdAt: "2026-10-08T00:00:00.000Z",
    sortOrder: 0,
    ...partial,
  };
}

const OVERRIDE = { reason: "The member received a promotion", actor: "user:reviewer", at: "2026-10-08T14:03:00.000Z", note: "Checked with payroll", ledgerSeq: 4711 };
const findings = [
  f({ findingId: "held", ruleId: "B40", severity: "WARNING", lineNumber: 10 }),
  f({ findingId: "held2", ruleId: "B40", severity: "WARNING", lineNumber: 11 }),
  f({ findingId: "done", ruleId: "B43", severity: "WARNING", lineNumber: 20, override: OVERRIDE }),
  f({ findingId: "cme", ruleId: "I5", severity: "COMPLETE_MEMBER_ERROR", lineNumber: 30 }),
  f({ findingId: "rej", ruleId: "B40", severity: "WARNING", lineNumber: 30 }),
  f({ findingId: "info", ruleId: "B41", severity: "INFORMATION", lineNumber: 10, visibility: "PRIVATE" }),
];
const rec = (lineNumber: number, outcome: FindingsRecord["outcome"]): FindingsRecord => ({ lineNumber, sinMasked: "***-***-123", firstName: "Ann", lastName: "Able", eventType: "TERFIN", eventDate: "2026-09-30", outcome });
const records: Record<number, FindingsRecord> = { 10: rec(10, "HELD"), 11: rec(11, "HELD"), 20: rec(20, "ACCEPTED"), 30: rec(30, "REJECTED") };
const facets = { bySeverity: [{ value: "COMPLETE_MEMBER_ERROR" as const, count: 1 }, { value: "WARNING" as const, count: 4 }, { value: "INFORMATION" as const, count: 1 }], byRule: [{ value: "B40", count: 3 }], byField: [], total: 6 };

function renderView(role: "EmployerSubmitter" | "Reviewer", extra: Partial<React.ComponentProps<typeof FindingsView>> = {}) {
  const reviewer = role === "Reviewer";
  return render(
    <TooltipProvider>
      <FindingsView batchId="b1" findings={findings} records={records} facets={facets} role={role} nextCursor={null} prevCursors={[]} rejectedRows={1} fileRejected={false} canSeePrivate={reviewer} canOverride={reviewer} batchStatus="VALIDATED" {...extra} />
    </TooltipProvider>,
  );
}

describe("FindingsView HELD / overridden states (ux 5.4.2, D6, GAP-OVR-1)", () => {
  beforeEach(() => {
    search = new URLSearchParams();
    replace.mockClear();
  });

  it("overrideBlockedReason: Submitter copy, rejected row, non-validated batch, otherwise null", () => {
    const w = findings[0];
    expect(overrideBlockedReason(w, records[10], false, "VALIDATED")).toBe(SUBMITTER_OVERRIDE_COPY);
    expect(overrideBlockedReason(w, records[30], true, "VALIDATED")).toMatch(/rejected by a member error/);
    expect(overrideBlockedReason(w, records[10], true, "LEDGERED")).toMatch(/only possible while the batch is Validated/);
    expect(overrideBlockedReason(w, records[10], true, "VALIDATED")).toBeNull();
    expect(overrideBlockedReason(findings[2], records[20], true, "VALIDATED")).toBeNull();
    expect(overrideBlockedReason(findings[3], records[30], true, "VALIDATED")).toBeNull();
  });

  it("Reviewer table: Override button on HELD-row warnings, Overridden state, pending/n-a on a rejected row, HELD/rejected row tints", () => {
    search = new URLSearchParams("group=severity");
    renderView("Reviewer");
    expect(screen.getByTestId("override-button-held")).toHaveTextContent("Override");
    expect(screen.getByTestId("override-button-held2")).toBeInTheDocument();
    expect(screen.getByTestId("override-state-done")).toHaveTextContent("Overridden");
    expect(screen.getByTestId("override-state-rej")).toHaveTextContent("pending · n/a");
    expect(screen.queryByTestId("override-button-rej")).toBeNull();
    expect(screen.queryByTestId("override-button-cme")).toBeNull();
    expect(screen.getByTestId("finding-row-held").className).toContain("bg-held-soft/40");
    expect(screen.getByTestId("finding-row-rej").className).toContain("bg-rejected-soft/30");
    expect(screen.getByTestId("finding-row-done").className).not.toContain("bg-held-soft");
    expect(screen.getByTestId("visibility-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("download-summary-private")).toBeInTheDocument();
  });

  it("expanding an overridden finding shows the amber strip with reason, note, actor, time and ledger link", () => {
    search = new URLSearchParams("group=severity");
    renderView("Reviewer");
    fireEvent.click(screen.getByTestId("finding-row-done"));
    const strip = screen.getByTestId("override-strip-done");
    expect(strip).toHaveTextContent("Overridden");
    expect(strip).toHaveTextContent("The member received a promotion");
    expect(strip).toHaveTextContent("Checked with payroll");
    expect(strip).toHaveTextContent("by reviewer");
    expect(strip).toHaveTextContent("2026-10-08 14:03");
    expect(within(strip).getByRole("link", { name: "ledger #4711" })).toHaveAttribute("href", "/ledger?seq=4711");
  });

  it("OverrideStrip renders nothing without an override and omits the ledger link when no seq is known", () => {
    const { container, rerender } = render(<OverrideStrip finding={findings[0]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OverrideStrip finding={{ ...findings[2], override: { reason: "r", actor: "user:a", at: "2026-01-02T03:04:05.000Z" } }} />);
    expect(screen.getByTestId("override-strip-done")).toHaveTextContent("by a");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("bulk selection: enabled only for two or more pending warnings of one rule; rejected rows have no checkbox", () => {
    search = new URLSearchParams("group=rule");
    renderView("Reviewer");
    const bulk = screen.getByTestId("bulk-override-button");
    expect(bulk).toBeDisabled();
    expect(screen.queryByTestId("select-finding-rej")).toBeNull();
    expect(screen.queryByTestId("select-finding-done")).toBeNull();
    fireEvent.click(screen.getByTestId("select-finding-held"));
    expect(bulk).toBeDisabled();
    fireEvent.click(screen.getByTestId("select-finding-held2"));
    expect(bulk).toBeEnabled();
    expect(bulk).toHaveTextContent("Override 2 selected");
  });

  it("PRIVATE toggle writes ?visibility=PUBLIC and back", () => {
    search = new URLSearchParams("group=severity");
    renderView("Reviewer");
    fireEvent.click(screen.getByTestId("visibility-toggle"));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("visibility=PUBLIC"), expect.anything());
    search = new URLSearchParams("group=severity&visibility=PUBLIC");
    renderView("Reviewer");
    const toggles = screen.getAllByTestId("visibility-toggle");
    fireEvent.click(toggles[toggles.length - 1]);
    expect(replace).toHaveBeenLastCalledWith(expect.not.stringContaining("visibility="), expect.anything());
  });

  it("row groups: HELD row shows the HELD badge + override pending; overridden row shows the count", () => {
    search = new URLSearchParams("group=row");
    renderView("Reviewer");
    const held = screen.getByTestId("finding-row-group-10");
    expect(within(held).getByTestId("outcome-badge-HELD")).toBeInTheDocument();
    expect(held).toHaveTextContent("override pending");
    expect(held.className).toContain("bg-held-soft/20");
    expect(within(held).getByTestId("override-button-held")).toBeInTheDocument();
    const done = screen.getByTestId("finding-row-group-20");
    expect(within(done).getByTestId("outcome-badge-ACCEPTED")).toBeInTheDocument();
    expect(done).toHaveTextContent("1 overridden");
    const rejected = screen.getByTestId("finding-row-group-30");
    expect(within(rejected).getByTestId("outcome-badge-REJECTED")).toBeInTheDocument();
    expect(within(rejected).queryByTestId("override-button-rej")).toBeNull();
    expect(rejected).toHaveTextContent("rejected by a member error");
  });

  it("Submitter: no Override buttons, no bulk button, no PRIVATE toggle, reviewer copy on pending warnings (D6)", () => {
    renderView("EmployerSubmitter");
    expect(screen.queryAllByTestId(/^override-button-/)).toHaveLength(0);
    expect(screen.queryByTestId("bulk-override-button")).toBeNull();
    expect(screen.queryByTestId("visibility-toggle")).toBeNull();
    expect(screen.queryByTestId("download-summary-private")).toBeNull();
    expect(screen.getAllByText(SUBMITTER_OVERRIDE_COPY).length).toBeGreaterThan(0);
  });
});
