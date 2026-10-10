// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutcomeBadge } from "@/components/app/badges/outcome-badge";
import { SeverityBadge } from "@/components/app/badges/severity-badge";
import { StatusBadge } from "@/components/app/badges/status-badge";
import { BATCH_STATUSES, FINDING_SEVERITIES } from "@/types";
import type { RecordOutcome } from "@/types";
import { BATCH_STATUS_MAP, INTEGRITY_MAP, OUTCOME_MAP, SEVERITY_MAP, SEVERITY_SHORT, TOKEN_CLASSES } from "@/lib/ui/status-map";

const RECORD_OUTCOMES: readonly RecordOutcome[] = ["ACCEPTED", "REJECTED", "HELD"];

describe("badges (P4 / P7)", () => {
  it("renders icon + text for every BatchStatus with a stable test id", () => {
    for (const s of BATCH_STATUSES) {
      const { unmount } = render(<StatusBadge status={s} />);
      const el = screen.getByTestId(`status-badge-${s}`);
      expect(el).toHaveAttribute("title", s);
      expect(el.querySelector("svg")).not.toBeNull();
      expect(el.textContent?.trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("pulses only for transient statuses by default", () => {
    const { container, rerender } = render(<StatusBadge status="RECEIVED" />);
    expect(container.querySelector(".motion-safe\\:animate-pulse-dot")).not.toBeNull();
    rerender(<StatusBadge status="VALIDATED" />);
    expect(container.querySelector(".motion-safe\\:animate-pulse-dot")).toBeNull();
  });

  it("VALIDATED with held rows reads 'Validated · 3 held'", () => {
    render(<StatusBadge status="VALIDATED" heldCount={3} />);
    expect(screen.getByTestId("status-badge-VALIDATED")).toHaveTextContent("Validated · 3 held");
  });

  it("renders every FindingSeverity and appends counts", () => {
    for (const s of FINDING_SEVERITIES) {
      const { unmount } = render(<SeverityBadge severity={s} count={3} />);
      expect(screen.getByTestId(`severity-badge-${s}`)).toHaveTextContent("· 3");
      unmount();
    }
  });

  it("status-map is complete: every status, severity and outcome (incl. HELD) has a label, icon and colour token", () => {
    for (const s of BATCH_STATUSES) expect(BATCH_STATUS_MAP[s], s).toMatchObject({ label: expect.any(String), icon: expect.anything() });
    for (const s of FINDING_SEVERITIES) {
      expect(SEVERITY_MAP[s], s).toMatchObject({ label: expect.any(String), icon: expect.anything() });
      expect(SEVERITY_SHORT[s], s).toEqual(expect.any(String));
    }
    for (const o of RECORD_OUTCOMES) expect(OUTCOME_MAP[o], o).toMatchObject({ label: expect.any(String), icon: expect.anything() });
    expect(Object.keys(OUTCOME_MAP).sort()).toEqual([...RECORD_OUTCOMES].sort());
    expect(OUTCOME_MAP.HELD.token).toBe("held");
    expect(OUTCOME_MAP.HELD.label).toMatch(/override/i);
    const entries = [...Object.values(BATCH_STATUS_MAP), ...Object.values(SEVERITY_MAP), ...Object.values(OUTCOME_MAP), ...Object.values(INTEGRITY_MAP)];
    for (const e of entries) expect(TOKEN_CLASSES[e.token], e.label).toBeDefined();
    // Labels differ within each map so colour is never the only cue (ux 8 / P7).
    expect(new Set(Object.values(OUTCOME_MAP).map((e) => e.label)).size).toBe(RECORD_OUTCOMES.length);
    expect(new Set(Object.values(SEVERITY_MAP).map((e) => e.label)).size).toBe(FINDING_SEVERITIES.length);
  });

  it("renders outcomes", () => {
    render(<OutcomeBadge outcome="HELD" />);
    expect(screen.getByTestId("outcome-badge-HELD")).toHaveTextContent("Held (needs override)");
  });

  it("matches the snapshot for a rejected status badge", () => {
    const { container } = render(<StatusBadge status="FILE_REJECTED" />);
    expect(container.firstChild).toMatchInlineSnapshot(`
      <span
        class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm font-medium bg-sev-cme-soft text-sev-cme-text px-2 py-0.5 text-caption"
        data-testid="status-badge-FILE_REJECTED"
        title="FILE_REJECTED"
      >
        <svg
          aria-hidden="true"
          class="lucide lucide-file-x h-3.5 w-3.5"
          fill="none"
          height="24"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
          />
          <path
            d="M14 2v5a1 1 0 0 0 1 1h5"
          />
          <path
            d="m14.5 12.5-5 5"
          />
          <path
            d="m9.5 12.5 5 5"
          />
        </svg>
        <span>
          File rejected
        </span>
      </span>
    `);
  });
});