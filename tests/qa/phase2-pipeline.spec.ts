import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedArielMock } from "@/lib/ariel/seed";
import { batches, eventsRecords, mockEmployments, mockRateTables, validationFindings } from "@/lib/db/schema";
import { decodeBytes } from "@/lib/events/decode";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import { revalidateOffline } from "@/lib/pipeline/revalidate";
import { goldenInput } from "../helpers/fixtures";
import { ADMIN, api, expectErrorEnvelope, REVIEWER, SUB_0235, upload } from "../helpers/qa-api";
import { createTestContext, fixtureSeed, type TestContext } from "../helpers/test-context";

/**
 * QA Phase 2: pipeline-level probes beyond tests/integration/phase2.spec.ts - silver-zone PII posture, offline
 * re-validation isolation, override/HELD edge semantics, rules-config effect boundaries.
 */

let t: TestContext;
let mixed: string;
const EXEC = "2026-10-08";
const B40_REASON = "The member received a promotion";
const lakeFile = (rel: string) => readFileSync(path.join(t.lakeRoot, ...rel.split("/")));
const body = (o: unknown) => JSON.stringify(o);
const findingsOf = (batchId: string) => t.ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, batchId));
/** Pending WARNING findings whose row is HELD (no CME on the same line) - the only ones an override can release (GAP-OVR-1). */
async function heldWarnings() {
  const all = await findingsOf(mixed);
  const rejectedLines = new Set(all.filter((f) => f.severity === "COMPLETE_MEMBER_ERROR").map((f) => f.lineNumber));
  return all.filter((f) => f.severity === "WARNING" && !f.overrideReason && !rejectedLines.has(f.lineNumber)).sort((a, b) => a.lineNumber! - b.lineNumber!);
}
async function located(batchId: string) {
  const [b] = await t.ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  return { b, paths: lakePaths({ employerId: b.employerId, batchId, ingestDate: ingestDateOf(b.receivedAt) }) };
}
const seedSins = () => fixtureSeed().members.map((m) => m.sin);
function expectNoSeedSin(text: string, label: string) {
  for (const s of seedSins()) expect(text.includes(s), `${label} must not contain seed SIN ${s.slice(0, 3)}...`).toBe(false);
}

beforeAll(async () => {
  t = await createTestContext();
  mixed = (await upload(goldenInput("mixed-100-rows"), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "mixed.csv" })).body.batchId;
});
afterAll(() => t.cleanup());

describe("QA/Phase2: silver zone and report PII posture (architecture 9.7 / 13.3)", () => {
  it("ariel-snapshot.ndjson carries pseudonym + mask only (no sin key, no seed SIN) but does carry names and DOB (Reviewer/Admin download only)", async () => {
    const { paths } = await located(mixed);
    const text = lakeFile(paths.silver.arielSnapshot).toString("utf8");
    const lines = text.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ kind: "meta", schemaVersion: 1, adapter: "MockArielAdapter", employerId: "0235" });
    expect(lines[0].batchId).toBeUndefined();
    expect(lines[1].kind).toBe("rates");
    const members = lines.filter((l) => l.kind === "member");
    expect(members.length).toBeGreaterThan(10);
    for (const m of members) {
      expect(m.sin).toBeUndefined();
      expect(m.sinPseudo).toMatch(/^[0-9a-f]{64}$/);
      expect(m.sinMasked).toMatch(/^\*\*\*-\*\*\*-\d{3}$/);
    }
    expectNoSeedSin(text, "ariel-snapshot.ndjson");
    expect(members.some((m) => typeof m.lastName === "string" && typeof m.dateOfBirth === "string")).toBe(true);
  });
  it("findings.ndjson, both summary CSVs, rules-config.json, the findings API and every ledger payload of the batch carry no seed SIN; the public CSV has no PRIVATE/SYS rows", async () => {
    const { paths } = await located(mixed);
    for (const rel of [paths.silver.findings, paths.gold.summaryOfValidations, paths.gold.summaryOfValidationsPrivate, paths.silver.rulesConfig]) expectNoSeedSin(lakeFile(rel).toString("utf8"), rel);
    expectNoSeedSin((await api.findings(REVIEWER, mixed, "?limit=200")).text, "findings API");
    const entries = await t.ctx.ledger.list({ batchId: mixed, limit: 200 });
    expect(entries.items.length).toBeGreaterThan(90);
    for (const e of entries.items) expectNoSeedSin(JSON.stringify(e.payload), `ledger seq ${e.seq}`);
    const pub = (await api.report(SUB_0235, mixed, "summary-of-validations.csv")).text;
    expect(pub).not.toMatch(/PRIVATE|SYS-RULE-ERROR|B41|B44|B182/);
    expectErrorEnvelope(await api.arielRates({}), 401, "UNAUTHENTICATED");
    const rates = await api.arielRates(SUB_0235);
    expect(rates.status).toBe(200);
    expect(rates.body.rows.every((r: { placeholder: boolean }) => r.placeholder === true)).toBe(true);
  });
});

describe("QA/Phase2: offline re-validation isolation (AC5)", () => {
  it("closing every mock employment after the fact does not change the offline result - the persisted snapshot is the input", async () => {
    const { paths } = await located(mixed);
    const before = lakeFile(paths.silver.findings).toString("utf8");
    await t.ctx.db.update(mockEmployments).set({ terminationDate: "2020-01-01", terminationCode: "TER" });
    try {
      const r = await revalidateOffline(t.ctx, mixed);
      expect(r.findingsNdjson).toBe(before);
      expect(r.counts).toEqual({ accepted: 19, rejected: 73, held: 8, findings: 116 });
    } finally {
      await seedArielMock(t.ctx.db, fixtureSeed(), { pseudonymKey: t.ctx.config.sinPseudonymKey, encKey: t.ctx.config.sinEncKey });
    }
  });
  it("BUG-REVAL-1 (fixed): rate tables are frozen in the persisted snapshot - changing MGA 2026 in the mock does not change the offline result", async () => {
    const { b, paths } = await located(mixed);
    const before = lakeFile(paths.silver.findings).toString("utf8");
    const snapshotLines = lakeFile(paths.silver.arielSnapshot).toString("utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; rows?: Array<{ table: string; year: number; value: string }> });
    const ratesLine = snapshotLines.find((l) => l.kind === "rates");
    expect(ratesLine?.rows?.find((r) => r.table === "MGA" && r.year === 2026)?.value).toBe("74600");
    expect(snapshotLines.indexOf(ratesLine!)).toBe(1);
    const where = and(eq(mockRateTables.tableName, "MGA"), eq(mockRateTables.year, 2026));
    await t.ctx.db.update(mockRateTables).set({ value: "50000" }).where(where);
    try {
      const r = await revalidateOffline(t.ctx, mixed);
      expect(r.findingsNdjson).toBe(before);
      expect(r.arielSnapshotHash).toBe(b.arielSnapshotHash);
      // The live adapter now disagrees with the frozen rates: a fresh snapshot would hash differently.
      const fresh = await t.ctx.ariel.snapshotForBatch("probe", "0235", snapshotLines.filter((l) => l.kind === "member").map((l) => (l as unknown as { sinPseudo: string }).sinPseudo));
      expect(fresh.hash).not.toBe(b.arielSnapshotHash);
    } finally {
      await t.ctx.db.update(mockRateTables).set({ value: "74600" }).where(where);
    }
  });
  it("after the rate row is restored the offline result matches again (sanity for the probe above)", async () => {
    const { paths } = await located(mixed);
    expect((await revalidateOffline(t.ctx, mixed)).findingsNdjson).toBe(lakeFile(paths.silver.findings).toString("utf8"));
  });
});

describe("QA/Phase2: override / HELD semantics beyond AC4", () => {
  it("GAP-OVR-1 (fixed): a warning on a REJECTED row cannot be overridden - 409 ROW_REJECTED, nothing persisted or ledgered", async () => {
    const all = await findingsOf(mixed);
    const rejectedLines = new Set(all.filter((f) => f.severity === "COMPLETE_MEMBER_ERROR").map((f) => f.lineNumber));
    const w = all.find((f) => f.severity === "WARNING" && !f.overrideReason && rejectedLines.has(f.lineNumber))!;
    expect(w, "a WARNING on a rejected row exists in mixed-100-rows").toBeTruthy();
    const { b: before } = await located(mixed);
    const head0 = (await t.ctx.ledger.head()).seq;
    expectErrorEnvelope(await api.override(REVIEWER, w.findingId, body({ reason: w.overrideReasons[0] })), 409, "ROW_REJECTED");
    const [row] = await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.findingId, w.findingId));
    expect(row.overrideReason).toBeNull();
    const [rec] = await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.recordId, w.recordId!));
    expect(rec.outcome).toBe("REJECTED");
    expect((await t.ctx.ledger.head()).seq).toBe(head0);
    expect((await located(mixed)).b.heldTotal).toBe(before.heldTotal);
    // Bulk: the rejected-row item fails per item with the same code while HELD items succeed.
    // B40 sits on HELD line 78 and REJECTED line 75 (line 77 is left for the "Other" probe below).
    const held = all.find((f) => f.ruleId === "B40" && f.lineNumber === 78 && !f.overrideReason)!;
    const rejectedB40 = all.find((f) => f.ruleId === "B40" && !f.overrideReason && rejectedLines.has(f.lineNumber))!;
    expect(held && rejectedB40, "B40 on both a HELD and a REJECTED row").toBeTruthy();
    const bulk = await api.bulkOverride(REVIEWER, mixed, body({ findingIds: [rejectedB40.findingId, held.findingId], reason: "Job reclassification" }));
    expect(bulk.status).toBe(207);
    expect(bulk.body.results[0]).toMatchObject({ ok: false, status: 409, code: "ROW_REJECTED" });
    expect(bulk.body.results[1]).toMatchObject({ ok: true });
  });
  it("an Other reason needs a note; the note is trimmed, returned, persisted and ledgered", async () => {
    const f = (await heldWarnings()).find((x) => x.ruleId === "B40")!;
    expectErrorEnvelope(await api.override(REVIEWER, f.findingId, body({ reason: "Other - please provide explanation", note: "   " })), 422, "NOTE_REQUIRED");
    const r = await api.override(REVIEWER, f.findingId, body({ reason: "Other - please provide explanation", note: "  promoted to team lead  " }));
    expect(r.status, r.text).toBe(200);
    expect(r.body.finding.override).toMatchObject({ reason: "Other - please provide explanation", note: "promoted to team lead" });
    const [row] = await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.findingId, f.findingId));
    expect(row.overrideNote).toBe("promoted to team lead");
    expect(Number(row.overrideLedgerSeq)).toBe(r.body.ledgerSeq);
    const entry = await t.ctx.ledger.list({ batchId: mixed, eventType: "WarningOverridden", limit: 50 });
    expect(entry.items.find((e) => e.seq === r.body.ledgerSeq)?.payload).toMatchObject({ note: "promoted to team lead", reason: "Other - please provide explanation" });
  });
  it("overrides are refused once the batch has left VALIDATED (422 BATCH_NOT_VALIDATED)", async () => {
    const f = (await heldWarnings())[0];
    await t.ctx.db.update(batches).set({ status: "LEDGERED" }).where(eq(batches.batchId, mixed));
    try {
      expectErrorEnvelope(await api.override(REVIEWER, f.findingId, body({ reason: f.overrideReasons[0] })), 422, "BATCH_NOT_VALIDATED");
    } finally {
      await t.ctx.db.update(batches).set({ status: "VALIDATED" }).where(eq(batches.batchId, mixed));
    }
    const [row] = await t.ctx.db.select().from(validationFindings).where(eq(validationFindings.findingId, f.findingId));
    expect(row.overrideReason).toBeNull();
  });
  it("bulk override is per item (not atomic): a bad id in the middle does not roll back the others; each success is its own ledger entry", async () => {
    const ids = (await heldWarnings()).filter((x) => x.ruleId === "B43").map((x) => x.findingId);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const head0 = (await t.ctx.ledger.head()).seq;
    const r = await api.bulkOverride(REVIEWER, mixed, body({ findingIds: [ids[0], "00000000-0000-7000-8000-00000000beef", ids[1]], reason: "Job reclassification" }));
    expect(r.status).toBe(207);
    expect(r.body.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false, true]);
    expect(r.body.results[1]).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect((await t.ctx.ledger.head()).seq - head0).toBeGreaterThanOrEqual(2);
  });
  it("after all overrides: config/snapshot hashes unchanged, heldTotal = HELD rows, warnings count unchanged, chain verifies", async () => {
    const { b } = await located(mixed);
    const first = await api.getBatch(REVIEWER, mixed);
    expect(first.body.rulesConfigHash).toBe((await api.rules()).body.config.hash);
    expect(b.arielSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const held = (await t.ctx.db.select().from(eventsRecords).where(and(eq(eventsRecords.batchId, mixed), eq(eventsRecords.outcome, "HELD")))).length;
    expect(b.heldTotal).toBe(held);
    expect(first.body.counts).toMatchObject({ held, warnings: 16 });
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
  });
});

describe("QA/Phase2: rules configuration effect boundary", () => {
  const header = () => decodeBytes(goldenInput("mixed-100-rows")).text.split(/\r?\n/)[0];
  const line = (n: number) => decodeBytes(goldenInput("mixed-100-rows")).text.split(/\r?\n/)[n - 1];
  const csv = (row: string) => Buffer.from(header() + "\r\n" + row + "\r\n", "latin1");
  it("disabling B40 affects new batches only: the earlier batch keeps its B40 findings and its config hash", async () => {
    const { b } = await located(mixed);
    const first = await upload(csv(line(77)), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "b40-on.csv" });
    expect(first.body.status, first.text).toBe("VALIDATED"); // line 77 carries a B40 warning -> HELD
    expect((await findingsOf(first.body.batchId)).map((f) => f.ruleId)).toContain("B40");
    const patched = await api.patchRule(ADMIN, "B40", body({ enabled: false, reason: "QA: disable B40" }));
    expect(patched.status, patched.text).toBe(200);
    try {
      const second = await upload(csv(line(77).replace(/^([^,]*,)([^,]*)/, "$1QA$2")), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "b40-off.csv" });
      expect(second.body.status, second.text).toBe("PENDING_APPROVAL"); // B40 disabled -> nothing HELD -> auto-advance
      expect(second.body.batchId).not.toBe(first.body.batchId);
      expect((await findingsOf(second.body.batchId)).map((f) => f.ruleId)).not.toContain("B40");
      expect((await api.getBatch(ADMIN, second.body.batchId)).body.rulesConfigHash).toBe(patched.body.config.hash);
      expect((await findingsOf(first.body.batchId)).map((f) => f.ruleId)).toContain("B40");
      expect((await api.getBatch(ADMIN, first.body.batchId)).body.rulesConfigHash).toBe(b.rulesConfigHash);
      expect((await api.rules()).body.items.find((r: { id: string }) => r.id === "B40")).toMatchObject({ enabled: false, overridden: true });
    } finally {
      expect((await api.deleteRule(ADMIN, "B40", "QA cleanup")).status).toBe(200);
    }
    expect((await api.rules()).body.config.hash).toBe(b.rulesConfigHash);
  });
  it("GAP-RULES-3 (fixed): toggling a rule off and back on through PATCH returns to the file hash - no redundant override, no overridden tag", async () => {
    const hash0 = (await api.rules()).body.config.hash;
    const off = await api.patchRule(ADMIN, "B40", body({ enabled: false, reason: "QA: off" }));
    expect(off.status, off.text).toBe(200);
    expect(off.body.config.hash).not.toBe(hash0);
    const on = await api.patchRule(ADMIN, "B40", body({ enabled: true, reason: "QA: on again" }));
    expect(on.status, on.text).toBe(200);
    expect(on.body.changes).toEqual([{ ruleId: "B40", key: "enabled", from: false, to: true }]);
    expect(on.body.ledgerSeq).toBeTypeOf("number");
    expect(on.body.config.hash).toBe(hash0);
    expect((await api.rules()).body.items.find((r: { id: string }) => r.id === "B40")).toMatchObject({ enabled: true, overridden: false });
    // Same for a tolerance set back to its file value.
    const t1 = await api.patchRule(ADMIN, "B53a", body({ tolerances: { "B53a.pa": 300 }, reason: "QA: widen" }));
    expect(t1.status, t1.text).toBe(200);
    const t2 = await api.patchRule(ADMIN, "B53a", body({ tolerances: { "B53a.pa": 250 }, reason: "QA: back to file" }));
    expect(t2.status, t2.text).toBe(200);
    expect(t2.body.config.hash).toBe(hash0);
  });
  it("GAP-RULES-1 (fixed): DELETE on an unknown rule id answers 404 NOT_FOUND", async () => {
    expectErrorEnvelope(await api.deleteRule(ADMIN, "NOPE", "QA probe"), 404, "NOT_FOUND");
  });
  it("GAP-RULES-2 (fixed): tolerance ranges are enforced - negative B40.pct, B47.min above B47.max, negative weeks and a positive B43.amount answer 422 INVALID_TOLERANCE without touching the hash", async () => {
    const hash0 = (await api.rules()).body.config.hash;
    expectErrorEnvelope(await api.patchRule(ADMIN, "B40", body({ tolerances: { "B40.pct": -1 }, reason: "QA probe" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B47", body({ tolerances: { "B47.min": 500000 }, reason: "QA probe" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B47", body({ tolerances: { "B47.min": 120000 }, reason: "QA probe" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B184a", body({ tolerances: { "B184a.weeks": -1 }, reason: "QA probe" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B43", body({ tolerances: { "B43.amount": 2500 }, reason: "QA probe" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B31", body({ tolerances: { "B31.windowStart": "13-40" }, reason: "QA probe" })), 422, "INVALID_TOLERANCE");
    expect((await api.rules()).body.config.hash).toBe(hash0);
    // In-range values are still accepted (and B47.min/max may move together).
    const ok = await api.patchRule(ADMIN, "B47", body({ tolerances: { "B47.min": 125000, "B47.max": 130000 }, reason: "QA probe" }));
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.changes).toHaveLength(2);
    expect((await api.deleteRule(ADMIN, "B47", "QA cleanup")).status).toBe(200);
    expect((await api.rules()).body.config.hash).toBe(hash0);
  });
  it("the mock Ariel member browser is hidden from Submitters and reseed is Admin-only; reseed is idempotent on the snapshot hash", async () => {
    expectErrorEnvelope(await api.arielMembers(SUB_0235), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.arielReseed(REVIEWER), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.arielReseed(SUB_0235), 403, "FORBIDDEN");
    const { paths } = await located(mixed);
    const membersOf = (rel: string) => lakeFile(rel).toString("utf8").split("\n").slice(1).join("\n");
    const r = await api.arielReseed(ADMIN);
    expect(r.status, r.text).toBe(200);
    const again = await upload(goldenInput("mixed-100-rows"), ADMIN, { employerId: "0359", executionDate: EXEC }, { filename: "other-employer.csv" });
    expect(["VALIDATED", "PENDING_APPROVAL"]).toContain(again.body.status);
    const { paths: p2 } = await located(again.body.batchId);
    // the meta line names the employer, so compare the member lines (same SINs requested, same deterministic ids)
    expect(membersOf(p2.silver.arielSnapshot)).toBe(membersOf(paths.silver.arielSnapshot));
  });
});
