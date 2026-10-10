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
  it.fails("BUG-REVAL-1: rate tables are not part of the persisted snapshot - changing MGA 2026 in the mock changes the offline result", async () => {
    const { paths } = await located(mixed);
    const before = lakeFile(paths.silver.findings).toString("utf8");
    const where = and(eq(mockRateTables.tableName, "MGA"), eq(mockRateTables.year, 2026));
    await t.ctx.db.update(mockRateTables).set({ value: "50000" }).where(where);
    try {
      const r = await revalidateOffline(t.ctx, mixed);
      expect(r.findingsNdjson).toBe(before);
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
  it("a warning on a REJECTED row may be overridden: the row stays REJECTED, heldTotal is unchanged and no MemberRecordValidated is ledgered", async () => {
    const all = await findingsOf(mixed);
    const rejectedLines = new Set(all.filter((f) => f.severity === "COMPLETE_MEMBER_ERROR").map((f) => f.lineNumber));
    const w = all.find((f) => f.severity === "WARNING" && !f.overrideReason && rejectedLines.has(f.lineNumber))!;
    expect(w, "a WARNING on a rejected row exists in mixed-100-rows").toBeTruthy();
    const { b: before } = await located(mixed);
    const r = await api.override(REVIEWER, w.findingId, body({ reason: w.overrideReasons[0] }));
    expect(r.status, r.text).toBe(200);
    expect(r.body.rowOutcome).toBe("REJECTED");
    expect(r.body.heldRemaining).toBe(before.heldTotal);
    const [rec] = await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.recordId, w.recordId!));
    expect(rec.outcome).toBe("REJECTED");
    expect((await t.ctx.ledger.list({ streamId: `member:${rec.sinPseudo}`, eventType: "MemberRecordValidated", limit: 10 })).items).toHaveLength(0);
    expect((await t.ctx.ledger.list({ streamId: `member:${rec.sinPseudo}`, eventType: "WarningOverridden", limit: 10 })).items[0].payload).toMatchObject({ rowOutcome: "REJECTED", findingId: w.findingId });
  });
  it("an Other reason needs a note; the note is trimmed, returned, persisted and ledgered", async () => {
    const f = (await findingsOf(mixed)).find((x) => x.ruleId === "B40" && !x.overrideReason)!;
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
    const f = (await findingsOf(mixed)).find((x) => x.severity === "WARNING" && !x.overrideReason)!;
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
    const all = await findingsOf(mixed);
    const ids = all.filter((x) => x.ruleId === "B43" && !x.overrideReason).map((x) => x.findingId);
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
    expect(first.body.status, first.text).toBe("VALIDATED");
    expect((await findingsOf(first.body.batchId)).map((f) => f.ruleId)).toContain("B40");
    const patched = await api.patchRule(ADMIN, "B40", body({ enabled: false, reason: "QA: disable B40" }));
    expect(patched.status, patched.text).toBe(200);
    try {
      const second = await upload(csv(line(77).replace(/^([^,]*,)([^,]*)/, "$1QA$2")), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "b40-off.csv" });
      expect(second.body.status, second.text).toBe("VALIDATED");
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
  it("GAP-RULES-1 (pinned): DELETE on an unknown rule id answers 200 (rule undefined, ledgerSeq null) instead of 404", async () => {
    const r = await api.deleteRule(ADMIN, "NOPE", "QA probe");
    expect(r.status).toBe(200);
    expect(r.body.rule).toBeUndefined();
    expect(r.body.ledgerSeq).toBeNull();
  });
  it("GAP-RULES-2 (pinned): tolerances are type-checked only - a negative B40.pct or a B47.min above B47.max is accepted", async () => {
    const a = await api.patchRule(ADMIN, "B40", body({ tolerances: { "B40.pct": -1 }, reason: "QA probe" }));
    expect(a.status).toBe(200);
    const c = await api.patchRule(ADMIN, "B47", body({ tolerances: { "B47.min": 500000 }, reason: "QA probe" }));
    expect(c.status).toBe(200);
    await api.deleteRule(ADMIN, "B40", "QA cleanup");
    await api.deleteRule(ADMIN, "B47", "QA cleanup");
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
    expect(again.body.status).toBe("VALIDATED");
    const { paths: p2 } = await located(again.body.batchId);
    // the meta line names the employer, so compare the member lines (same SINs requested, same deterministic ids)
    expect(membersOf(p2.silver.arielSnapshot)).toBe(membersOf(paths.silver.arielSnapshot));
  });
});
