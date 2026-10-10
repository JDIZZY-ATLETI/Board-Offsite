import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, eventsRecords, validationFindings } from "@/lib/db/schema";
import { decodeBytes } from "@/lib/events/decode";
import { pseudonymizeSin } from "@/lib/pii/sin";
import { dumpProjections } from "@/lib/projection";
import { goldenInput } from "../helpers/fixtures";
import { ADMIN, api, expectErrorEnvelope, REVIEWER, SUB_0235, upload } from "../helpers/qa-api";
import { createTestContext, fixtureSeed, type TestContext } from "../helpers/test-context";

/** Phase 3 step 5/6: member lookup + projection API, CorrectionAppended heuristics, mixed-100-rows build after overrides. */
let t: TestContext;
const EXEC = "2026-10-08";
const body = (o: unknown) => JSON.stringify(o);
const mixedLines = () => decodeBytes(goldenInput("mixed-100-rows")).text.split(/\r?\n/);
const csvOf = (...rows: string[]) => Buffer.from([mixedLines()[0], ...rows].join("\r\n") + "\r\n", "latin1");
const terfinLine2 = () => decodeBytes(goldenInput("happy-terfin")).text.split(/\r?\n/)[1];

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.cleanup());

describe("Phase 3: mixed-100-rows builds once every HELD warning is overridden", () => {
  it("8 HELD rows -> overrides -> automatic LEDGERED/PROJECTION_BUILT/PENDING_APPROVAL with items for every accepted row", async () => {
    const r = await upload(goldenInput("mixed-100-rows"), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "mixed.csv" });
    expect(r.body.status).toBe("VALIDATED");
    const id = r.body.batchId as string;
    const held = (await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, id))).filter((x) => x.outcome === "HELD");
    expect(held.length).toBe(8);
    for (const rec of held) {
      const warnings = (await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.recordId, rec.recordId))).filter((f) => f.severity === "WARNING" && !f.overrideReason);
      for (const w of warnings) {
        const reason = w.overrideReasons[0];
        const ov = await api.override(REVIEWER, w.findingId, body({ reason, ...(/^other\b/i.test(reason) ? { note: "QA mixed override" } : {}) }));
        expect(ov.status, `${w.ruleId}: ${ov.text}`).toBe(200);
      }
    }
    const b = await api.getBatch(REVIEWER, id);
    expect(b.body.status).toBe("PENDING_APPROVAL");
    expect(b.body.counts.held).toBe(0);
    const view = await api.updateSet(REVIEWER, id);
    // Line 51 is an accepted DECFIN row without any event date: no items, flagged INFO-NO-DERIVATION (section 18 Q30).
    const noDerivation = (await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, id))).filter((f) => f.ruleId === "INFO-NO-DERIVATION");
    expect(noDerivation.map((f) => f.lineNumber)).toEqual([51]);
    expect(noDerivation[0]).toMatchObject({ severity: "INFORMATION", params: { reason: "EVENT_DATE_MISSING" } });
    expect(view.body.updateSet.memberCount).toBe(b.body.counts.accepted - 1);
    expect(view.body.updateSet.itemCount).toBeGreaterThan(b.body.counts.accepted * 4);
    expect(view.body.members.some((m: { overrides: unknown[] }) => m.overrides.length > 0)).toBe(true);
    const proposed = await t.ctx.ledger.list({ batchId: id, eventType: "ArielUpdateProposed", limit: 200 });
    expect(proposed.items).toHaveLength(b.body.counts.accepted - 1);
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
  });
});

describe("Phase 3: CorrectionAppended + member API", () => {
  const m1 = () => pseudonymizeSin(t.ctx.config.sinPseudonymKey, "900000019");
  it("a resubmitted row for a member whose earlier proposal is unexported gets CorrectionAppended{RESUBMITTED_PROPOSAL}", async () => {
    const first = await upload(csvOf(terfinLine2()), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "m1-a.csv" });
    expect(first.body.status).toBe("PENDING_APPROVAL");
    const corrected = terfinLine2().replace(/,38\.00,/, ",37.00,");
    expect(corrected).not.toBe(terfinLine2());
    const second = await upload(csvOf(corrected), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "m1-b.csv" });
    expect(second.body.status).toBe("PENDING_APPROVAL");
    const stream = await t.ctx.ledger.list({ streamId: `member:${m1()}`, order: "asc", limit: 200 });
    const types = stream.items.map((e) => e.eventType);
    expect(types.filter((x) => x === "CorrectionAppended")).toHaveLength(1);
    const corr = stream.items.find((e) => e.eventType === "CorrectionAppended")!;
    const firstProposal = stream.items.find((e) => e.eventType === "ArielUpdateProposed" && e.batchId === first.body.batchId)!;
    const secondProposal = stream.items.find((e) => e.eventType === "ArielUpdateProposed" && e.batchId === second.body.batchId)!;
    expect(corr.batchId).toBe(second.body.batchId);
    expect(corr.payload).toMatchObject({ kind: "RESUBMITTED_PROPOSAL", supersedesEntryId: firstProposal.entryId, supersedesSeq: firstProposal.seq, supersedesBatchId: first.body.batchId, supersedesEventType: "ArielUpdateProposed", newEntryId: secondProposal.entryId, eventType: "TERFIN", eventDate: "2026-09-30" });
    expect(JSON.stringify(corr.payload)).not.toMatch(/9000\d{5}/);
  });
  it("a corrected re-upload of a rejected row gets CorrectionAppended{CORRECTED_REJECTION}", async () => {
    const line65 = mixedLines()[64];
    const rejected = await upload(csvOf(line65), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "l65-a.csv" });
    expect((await api.getBatch(ADMIN, rejected.body.batchId)).body.counts.rejected).toBe(1);
    const sin = line65.split(",")[0];
    const stream = `member:${pseudonymizeSin(t.ctx.config.sinPseudonymKey, sin)}`;
    expect((await api.patchRule(ADMIN, "B112", body({ enabled: false, reason: "QA: correction path" }))).status).toBe(200);
    try {
      const fixed = await upload(csvOf(line65.replace(/^([^,]*,)([^,]*)/, "$1QA$2")), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "l65-b.csv" });
      expect(fixed.body.status).toBe("PENDING_APPROVAL");
      const entries = (await t.ctx.ledger.list({ streamId: stream, order: "asc", limit: 200 })).items;
      // Two rejections (mixed-100-rows above + l65-a); the correction points at the most recent one.
      expect(entries.map((e) => e.eventType)).toEqual(["MemberRecordRejected", "MemberRecordRejected", "MemberRecordValidated", "ArielUpdateProposed", "CorrectionAppended"]);
      expect(entries[4].payload).toMatchObject({ kind: "CORRECTED_REJECTION", supersedesEntryId: entries[1].entryId, supersedesSeq: entries[1].seq, supersedesEventType: "MemberRecordRejected", newEntryId: entries[3].entryId });
      const view = await api.member(REVIEWER, stream.slice("member:".length));
      expect(view.status, view.text).toBe(200);
      expect(view.body.projection).toMatchObject({ corrections: 1, lastEventType: "CorrectionAppended" });
      expect(view.body.projection.timeline.find((x: { seq: number }) => x.seq === entries[1].seq).supersededBySeq).toBe(entries[4].seq);
      expect(view.body.projection.timeline.find((x: { seq: number }) => x.seq === entries[0].seq).supersededBySeq).toBeUndefined();
      expect(view.body.timeline.map((e: { seq: number }) => e.seq)).toEqual(entries.map((e) => e.seq));
    } finally {
      await api.deleteRule(ADMIN, "B112", "QA cleanup");
    }
  });
  it("POST /api/members/lookup hashes the SIN, never echoes it, and is audit-logged; GET /api/members/{sinPseudo} returns projection + timeline + items + Ariel summary", async () => {
    const r = await api.memberLookup(REVIEWER, body({ sin: "900000019" }));
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({ sinPseudo: m1(), sinMasked: "***-***-019", found: true, inAriel: true });
    expect(r.text).not.toContain("900000019");
    const padded = await api.memberLookup(ADMIN, body({ sin: " 900000019 " }));
    expect(padded.body.sinPseudo).toBe(m1());
    const unknown = await api.memberLookup(ADMIN, body({ sin: "123456782" }));
    expect(unknown.body).toMatchObject({ found: false, inAriel: false });
    expectErrorEnvelope(await api.memberLookup(ADMIN, body({ sin: "12-34" })), 400, "INVALID_SIN");
    // Short digit strings are left-padded like the file layout (section 4.1), so they are valid lookups.
    expect((await api.memberLookup(ADMIN, body({ sin: "12345" }))).body.sinMasked).toBe("***-***-345");
    expectErrorEnvelope(await api.memberLookup(SUB_0235, body({ sin: "900000019" })), 403, "FORBIDDEN");
    const audits = (await t.ctx.db.select().from(auditLog)).filter((a) => a.action === "MEMBER_LOOKUP");
    expect(audits.length).toBe(4);
    expect(JSON.stringify(audits)).not.toMatch(/9000000\d\d|123456782/);
    expect(audits[0].target).toBe(`member:${m1()}`);

    const v = await api.member(REVIEWER, m1());
    expect(v.status, v.text).toBe(200);
    expect(v.body.projection).toMatchObject({ sinPseudo: m1(), sinMasked: "***-***-019", employerIds: ["0235"], corrections: 1 });
    expect(v.body.projection.lastName).toBeTruthy();
    expect(v.body.projection.arielStatus).toMatchObject({ status: "D", subStatus: "NCT", previousStatus: "A", state: "PROPOSED" });
    expect(v.body.projection.pendingItems).toBeGreaterThan(0);
    const ledger = await api.ledgerEntries(REVIEWER, `?streamId=${encodeURIComponent(`member:${m1()}`)}&order=asc&limit=200`);
    expect(v.body.timeline.map((e: { seq: number }) => e.seq)).toEqual(ledger.body.items.map((e: { seq: number }) => e.seq));
    expect(v.body.projection.timeline.map((e: { seq: number }) => e.seq)).toEqual(ledger.body.items.map((e: { seq: number }) => e.seq));
    expect(v.body.items.length).toBeGreaterThan(0);
    expect(v.body.items.every((i: { sinPseudo: string }) => i.sinPseudo === m1())).toBe(true);
    expect(v.body.ariel).toMatchObject({ sinMasked: "***-***-019", membership: { status: "A" } });
    expect(v.body.ariel.employments[0]).toMatchObject({ employerId: "0235" });
    expect(v.text).not.toContain("900000019");
    expectErrorEnvelope(await api.member(REVIEWER, "f".repeat(64)), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.member(REVIEWER, "not-a-pseudonym"), 400);
    // Ariel-only member (never in a batch): snapshot summary, empty timeline.
    const projected = new Set((await dumpProjections(t.ctx)).map((p) => p.sinPseudo));
    const arielOnly = fixtureSeed().members.map((m) => pseudonymizeSin(t.ctx.config.sinPseudonymKey, m.sin)).find((p) => !projected.has(p))!;
    expect(arielOnly).toBeTruthy();
    const only = await api.member(ADMIN, arielOnly);
    expect(only.status, only.text).toBe(200);
    expect(only.body.projection).toBeNull();
    expect(only.body.timeline).toEqual([]);
    expect(only.body.items).toEqual([]);
    expect(only.body.ariel.memberId).toBeTruthy();
  });
  it("POST /api/projections/rebuild (Admin) replays from seq 1 and yields identical rows; audit-logged", async () => {
    const before = await dumpProjections(t.ctx);
    expect(before.length).toBeGreaterThan(20);
    const r = await api.projectionsRebuild(ADMIN);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ fromSeq: 1 });
    expect(r.body.toSeq).toBe((await api.ledgerHead()).body.seq);
    expect(await dumpProjections(t.ctx)).toEqual(before);
    expect((await t.ctx.db.select().from(auditLog)).some((a) => a.action === "REBUILD_PROJECTIONS")).toBe(true);
  });
});