import { describe, expect, it } from "vitest";
import { canTransition, InvalidTransitionError, TRANSITIONS } from "@/lib/pipeline/state-machine";
import { BATCH_STATUSES } from "@/types";

describe("batch state machine", () => {
  it("covers every status", () => {
    for (const s of BATCH_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });
  it("allows the Phase 1 path and rejects shortcuts", () => {
    expect(canTransition("RECEIVED", "PARSED")).toBe(true);
    expect(canTransition("PARSED", "VALIDATED")).toBe(true);
    expect(canTransition("RECEIVED", "FILE_REJECTED")).toBe(true);
    expect(canTransition("RECEIVED", "VALIDATED")).toBe(false);
    expect(canTransition("FILE_REJECTED", "RECEIVED")).toBe(false);
    expect(canTransition("FAILED", "RECEIVED")).toBe(true);
    expect(new InvalidTransitionError("RECEIVED", "EXPORTED").message).toContain("RECEIVED -> EXPORTED");
  });
});
