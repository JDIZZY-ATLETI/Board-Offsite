// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationFinding } from "@/types";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { OVERRIDE_ERROR_COPY, OverrideDrawer, isOtherReason, overrideErrorCopy } from "@/components/app/findings/override-drawer";

const REASONS = ["The member received a promotion", "Job reclassification", "Other - please provide explanation"];
const loadReasons = vi.fn(async () => REASONS);

function f(partial: Partial<ValidationFinding> & Pick<ValidationFinding, "findingId">): ValidationFinding {
  return {
    batchId: "b1",
    recordId: "r1",
    lineNumber: 73,
    sinPseudo: null,
    ruleId: "B40",
    severity: "WARNING",
    messageId: "7854",
    level: "L2",
    visibility: "PUBLIC",
    field: "AnnualizedEarnings_CurrentYear",
    yearScope: "CURRENT",
    params: {},
    dataImportMessage: "DI",
    portalMessage: "Earnings look high for the service reported.",
    overrideReasons: REASONS,
    createdAt: "2026-10-08T00:00:00.000Z",
    sortOrder: 0,
    ...partial,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderDrawer(targets: ValidationFinding[], extra: Partial<React.ComponentProps<typeof OverrideDrawer>> = {}) {
  const onOpenChange = vi.fn();
  const onRecorded = vi.fn();
  render(<OverrideDrawer batchId="b1" targets={targets.map((finding) => ({ finding }))} open onOpenChange={onOpenChange} onRecorded={onRecorded} loadReasons={loadReasons} {...extra} />);
  return { onOpenChange, onRecorded };
}

describe("OverrideDrawer (ux 4.9 / 6.4 / 7.5)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    loadReasons.mockClear();
    refresh.mockClear();
    for (const k of Object.values(toast)) k.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the rule reasons verbatim as radios and keeps submit disabled until one is chosen", async () => {
    renderDrawer([f({ findingId: "w1" })]);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    const list = await screen.findByTestId("override-reasons");
    expect(loadReasons).toHaveBeenCalledWith("B40");
    const radios = list.querySelectorAll("input[type=radio]");
    expect(radios).toHaveLength(3);
    expect([...radios].map((r) => (r as HTMLInputElement).value)).toEqual(REASONS);
    expect(screen.getByTestId("override-submit")).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Job reclassification"));
    expect(screen.getByTestId("override-submit")).toBeEnabled();
  });

  it("falls back to the finding reasons when the rule lookup fails", async () => {
    renderDrawer([f({ findingId: "w1", overrideReasons: ["Only reason"] })], { loadReasons: vi.fn(async () => { throw new Error("HTTP 500"); }) });
    const list = await screen.findByTestId("override-reasons");
    expect(list.querySelectorAll("input[type=radio]")).toHaveLength(1);
    expect(screen.getByLabelText("Only reason")).toBeInTheDocument();
  });

  it("Other requires a note: submit stays disabled, the note is marked required, help copy explains why", async () => {
    renderDrawer([f({ findingId: "w1" })]);
    await screen.findByTestId("override-reasons");
    await userEvent.click(screen.getByLabelText("Other - please provide explanation"));
    const note = screen.getByTestId("override-note");
    expect(note).toBeRequired();
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("override-submit")).toBeDisabled();
    expect(screen.getByText(/A note is required when the reason is/)).toBeInTheDocument();
    await userEvent.type(note, "Verified against the payroll register");
    expect(screen.getByTestId("override-submit")).toBeEnabled();
    expect(isOtherReason("Other - please provide explanation")).toBe(true);
    expect(isOtherReason("Another reason entirely")).toBe(false);
  });

  it("posts the single override and reports the row outcome", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { rowOutcome: "ACCEPTED", heldRemaining: 7, ledgerSeq: 101 }));
    const { onOpenChange, onRecorded } = renderDrawer([f({ findingId: "w1" })]);
    await screen.findByTestId("override-reasons");
    await userEvent.click(screen.getByLabelText("The member received a promotion"));
    await userEvent.type(screen.getByTestId("override-note"), "  context  ");
    await userEvent.click(screen.getByTestId("override-submit"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/batches/b1/findings/w1/override");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "The member received a promotion", note: "context" });
    expect(toast.success).toHaveBeenCalledWith("Override recorded. Row 73 is now accepted.");
    expect(onRecorded).toHaveBeenCalledWith({ applied: 1, failed: 0, heldRemaining: 7 });
    expect(refresh).toHaveBeenCalled();
  });

  it.each(["REASON_NOT_ALLOWED", "NOTE_REQUIRED", "ALREADY_OVERRIDDEN", "ROW_REJECTED", "BATCH_NOT_VALIDATED"] as const)("maps %s to its UX copy in the inline alert and keeps the drawer open", async (code) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(code === "ALREADY_OVERRIDDEN" || code === "ROW_REJECTED" ? 409 : 422, { error: { code, message: "server text" } }));
    const { onOpenChange } = renderDrawer([f({ findingId: "w1" })]);
    await screen.findByTestId("override-reasons");
    await userEvent.click(screen.getByLabelText("Job reclassification"));
    await userEvent.click(screen.getByTestId("override-submit"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(OVERRIDE_ERROR_COPY[code]);
    expect(alert).not.toHaveTextContent("server text");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("overrideErrorCopy falls back to the server message, then to a generic line", () => {
    expect(overrideErrorCopy("SOMETHING_NEW", "server said so")).toBe("server said so");
    expect(overrideErrorCopy(undefined, "")).toBe("Something went wrong recording the override.");
    expect(overrideErrorCopy("ROW_REJECTED", "ignored")).toBe(OVERRIDE_ERROR_COPY.ROW_REJECTED);
  });

  it("bulk: one reason for several findings, per-item failures listed, partial toast", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(207, {
        heldRemaining: 5,
        results: [
          { findingId: "w1", ok: true, rowOutcome: "ACCEPTED", ledgerSeq: 102 },
          { findingId: "w2", ok: false, status: 409, code: "ROW_REJECTED", message: "x" },
        ],
      }),
    );
    const { onOpenChange, onRecorded } = renderDrawer([f({ findingId: "w1", lineNumber: 73 }), f({ findingId: "w2", lineNumber: 80 })]);
    expect(screen.getByText("Record override for 2 warnings")).toBeInTheDocument();
    await screen.findByTestId("override-reasons");
    await userEvent.click(screen.getByLabelText("Job reclassification"));
    await userEvent.click(screen.getByTestId("override-submit"));
    const items = await screen.findByTestId("override-item-errors");
    expect(items).toHaveTextContent("Row 80");
    expect(items).toHaveTextContent(OVERRIDE_ERROR_COPY.ROW_REJECTED);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/batches/b1/findings/override");
    expect(JSON.parse(String(init?.body))).toEqual({ findingIds: ["w1", "w2"], reason: "Job reclassification" });
    expect(toast.warning).toHaveBeenCalledWith("1 of 2 overrides recorded. 1 could not be applied.");
    expect(onRecorded).toHaveBeenCalledWith({ applied: 1, failed: 1, heldRemaining: 5 });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
