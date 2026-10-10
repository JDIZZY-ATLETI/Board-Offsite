// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleCatalogueItem } from "@/lib/queries/rules";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/rules",
  useSearchParams: () => search,
}));
vi.mock("sonner", () => ({ toast }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { RulesTable } from "@/components/app/rules/rules-table";

function rule(partial: Partial<RuleCatalogueItem> & Pick<RuleCatalogueItem, "id">): RuleCatalogueItem {
  return {
    label: `Rule ${partial.id}`,
    messageId: "7854",
    messageIds: ["7854"],
    level: "L2",
    severity: "WARNING",
    visibility: "PUBLIC",
    section: ["4.6"],
    tool: "DataImport",
    overrideReasons: ["The member received a promotion"],
    enabledByDefault: true,
    enabled: true,
    overridden: false,
    requiresAriel: true,
    dataImportMessage: "DI",
    portalMessage: "Portal",
    specNote: null,
    implemented: true,
    tolerances: [],
    ...partial,
  };
}
const items = [
  rule({ id: "B40" }),
  rule({ id: "B47", severity: "INFORMATION", visibility: "PRIVATE", tolerances: [{ key: "B47.min", value: 1000, unit: "CAD", type: "number", min: 0, max: 100000 }, { key: "B47.max", value: 250000, unit: "CAD", type: "number" }] }),
  rule({ id: "B5", enabled: false, overridden: true }),
];

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function renderTable(canEdit = true, overriddenKeys: Record<string, string[]> = {}) {
  return render(
    <TooltipProvider>
      <RulesTable items={items} canEdit={canEdit} overriddenKeys={overriddenKeys} />
    </TooltipProvider>,
  );
}

describe("RulesTable + RuleChangeDialog (ux 5.9 / 7.5)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    search = new URLSearchParams();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    refresh.mockClear();
    for (const k of Object.values(toast)) k.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders a switch per rule with the effective state and an overridden tag; Reviewer switches are disabled", () => {
    renderTable(false);
    const b40 = screen.getByTestId("rule-toggle-B40");
    expect(b40).toHaveAttribute("role", "switch");
    expect(b40).toHaveAttribute("aria-checked", "true");
    expect(b40).toBeDisabled();
    expect(screen.getByTestId("rule-toggle-B5")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("overridden")).toBeInTheDocument();
    expect(screen.queryByTestId("rule-tolerance-B47")).toBeNull();
    expect(screen.queryByTestId("rule-reset-B5")).toBeNull();
  });

  it("toggling a rule opens the change dialog, requires a reason and PATCHes enabled + reason", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { config: { hash: "abcd1234efgh5678" }, changes: [{}], ledgerSeq: 9 }));
    renderTable();
    fireEvent.click(screen.getByTestId("rule-toggle-B40"));
    const dialog = await screen.findByTestId("rule-change-dialog");
    expect(dialog).toHaveTextContent("Disable rule B40?");
    expect(dialog).toHaveTextContent("applies to batches received from now on");
    const confirm = screen.getByTestId("rule-change-confirm");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByTestId("rule-change-reason"), "ab");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByTestId("rule-change-reason"), "c - temporary");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/rules/B40");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "abc - temporary", enabled: false });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("hash abcd…5678"));
    expect(screen.queryByTestId("rule-change-dialog")).toBeNull();
  });

  it("enabling a disabled rule sends enabled: true", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { config: { hash: "ffff0000ffff0000" }, changes: [{}], ledgerSeq: 10 }));
    renderTable();
    fireEvent.click(screen.getByTestId("rule-toggle-B5"));
    expect(await screen.findByTestId("rule-change-dialog")).toHaveTextContent("Enable rule B5?");
    await userEvent.type(screen.getByTestId("rule-change-reason"), "re-enable");
    await userEvent.click(screen.getByTestId("rule-change-confirm"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ reason: "re-enable", enabled: true });
  });

  it("tolerance dialog: only changed keys are sent; a 422 INVALID_TOLERANCE is shown inline and the dialog stays open", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { error: { code: "INVALID_TOLERANCE", message: "B47.min must be <= 100000" } }));
    renderTable();
    fireEvent.click(screen.getByTestId("rule-tolerance-B47"));
    const dialog = await screen.findByTestId("tolerance-dialog");
    expect(dialog).toHaveTextContent("0 to 100000");
    const min = screen.getByLabelText(/B47\.min/);
    await userEvent.clear(min);
    await userEvent.type(min, "500000");
    await userEvent.type(screen.getByTestId("rule-change-reason"), "probe");
    await userEvent.click(screen.getByTestId("rule-change-confirm"));
    const alert = await screen.findByText(/outside the allowed range/);
    expect(alert).toHaveTextContent("B47.min must be <= 100000");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ reason: "probe", tolerances: { "B47.min": 500000 } });
    expect(screen.getByTestId("tolerance-dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reset to file sends DELETE with the reason as a query parameter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { config: { hash: "1111222233334444" }, changes: [{}], ledgerSeq: 11 }));
    renderTable(true, { B5: [] });
    fireEvent.click(screen.getByTestId("rule-reset-B5"));
    expect(await screen.findByTestId("rule-change-dialog")).toHaveTextContent("Reset B5 to the file defaults?");
    await userEvent.type(screen.getByTestId("rule-change-reason"), "back to spec");
    await userEvent.click(screen.getByTestId("rule-change-confirm"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/rules/B5?reason=back%20to%20spec");
    expect(init?.method).toBe("DELETE");
  });
});
