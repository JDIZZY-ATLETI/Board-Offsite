import { describe, expect, it } from "vitest";
import { BATCH_STATUS_MAP, batchStatusEntry, INTEGRITY_MAP, OPERATION_MAP, OUTCOME_MAP, PIPELINE_STEPS, SEVERITY_MAP, SEVERITY_SHORT, TOKEN_CLASSES } from "@/lib/ui/status-map";
import { BATCH_STATUSES, FINDING_SEVERITIES } from "@/types";

const OUTCOMES = ["ACCEPTED", "HELD", "REJECTED"] as const;
const INTEGRITY = ["ok", "tampered", "unverified"] as const;
const OPERATIONS = ["CREATE", "UPDATE", "UPSERT_ADD", "CLOSE", "DELETE", "SET_FLAG"] as const;

/** P4: one state language. Every enum value has exactly one label + token + icon. */
describe("status-map completeness", () => {
  it("maps every BatchStatus", () => {
    for (const s of BATCH_STATUSES) {
      const e = BATCH_STATUS_MAP[s];
      expect(e, s).toBeDefined();
      expect(e.label.length).toBeGreaterThan(0);
      expect(TOKEN_CLASSES[e.token]).toBeDefined();
      expect(typeof e.icon).toBe("object");
    }
  });

  it("maps every FindingSeverity (long + short labels)", () => {
    for (const s of FINDING_SEVERITIES) {
      expect(SEVERITY_MAP[s]).toBeDefined();
      expect(SEVERITY_SHORT[s]).toBeTruthy();
      expect(TOKEN_CLASSES[SEVERITY_MAP[s].token]).toBeDefined();
    }
  });

  it("maps outcomes, integrity states and Ariel operations", () => {
    for (const o of OUTCOMES) expect(OUTCOME_MAP[o]).toBeDefined();
    for (const i of INTEGRITY) expect(INTEGRITY_MAP[i]).toBeDefined();
    for (const op of OPERATIONS) expect(OPERATION_MAP[op]).toBeDefined();
  });

  it("VALIDATED with held rows becomes an attention state", () => {
    expect(batchStatusEntry("VALIDATED", 0).token).toBe("st-transient");
    const held = batchStatusEntry("VALIDATED", 3);
    expect(held.token).toBe("st-attention");
    expect(held.label).toContain("3 held");
  });

  it("pipeline steps cover the main path in order", () => {
    expect(PIPELINE_STEPS).toEqual(["RECEIVED", "PARSED", "VALIDATED", "LEDGERED", "PROJECTION_BUILT", "PENDING_APPROVAL", "APPROVED", "EXPORTED"]);
  });

  it("labels and tokens match the section 3.3 table (snapshot)", () => {
    const table = {
      severity: Object.fromEntries(FINDING_SEVERITIES.map((s) => [s, { label: SEVERITY_MAP[s].label, token: SEVERITY_MAP[s].token }])),
      outcome: Object.fromEntries(OUTCOMES.map((s) => [s, { label: OUTCOME_MAP[s].label, token: OUTCOME_MAP[s].token }])),
      status: Object.fromEntries(BATCH_STATUSES.map((s) => [s, { label: BATCH_STATUS_MAP[s].label, token: BATCH_STATUS_MAP[s].token }])),
      integrity: Object.fromEntries(INTEGRITY.map((s) => [s, { label: INTEGRITY_MAP[s].label, token: INTEGRITY_MAP[s].token }])),
    };
    expect(table).toMatchInlineSnapshot(`
      {
        "integrity": {
          "ok": {
            "label": "Verified",
            "token": "verified",
          },
          "tampered": {
            "label": "Integrity failure",
            "token": "tampered",
          },
          "unverified": {
            "label": "Not verified",
            "token": "unverified",
          },
        },
        "outcome": {
          "ACCEPTED": {
            "label": "Accepted",
            "token": "ok",
          },
          "HELD": {
            "label": "Held (needs override)",
            "token": "held",
          },
          "REJECTED": {
            "label": "Rejected",
            "token": "rejected",
          },
        },
        "severity": {
          "COMPLETE_MEMBER_ERROR": {
            "label": "Rejected (member error)",
            "token": "sev-cme",
          },
          "FILE_ERROR": {
            "label": "File error",
            "token": "sev-file",
          },
          "INFORMATION": {
            "label": "Information",
            "token": "sev-info",
          },
          "WARNING": {
            "label": "Warning — override needed",
            "token": "sev-warn",
          },
        },
        "status": {
          "APPROVED": {
            "label": "Approved",
            "token": "st-ok",
          },
          "EXPORTED": {
            "label": "Exported",
            "token": "st-ok",
          },
          "FAILED": {
            "label": "Failed — retry available",
            "token": "st-bad",
          },
          "FILE_REJECTED": {
            "label": "File rejected",
            "token": "st-bad",
          },
          "LEDGERED": {
            "label": "Written to ledger",
            "token": "st-transient",
          },
          "PARSED": {
            "label": "Parsed",
            "token": "st-transient",
          },
          "PENDING_APPROVAL": {
            "label": "Pending approval",
            "token": "st-attention",
          },
          "PROJECTION_BUILT": {
            "label": "Update Set built",
            "token": "st-transient",
          },
          "RECEIVED": {
            "label": "Received",
            "token": "st-transient",
          },
          "REJECTED": {
            "label": "Rejected by reviewer",
            "token": "st-bad",
          },
          "VALIDATED": {
            "label": "Validated",
            "token": "st-transient",
          },
        },
      }
    `);
  });
});