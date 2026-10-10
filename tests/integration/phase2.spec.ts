import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAppContextForTests } from "@/lib/app-context";
import { auditLog, batches, eventsRecords, validationFindings } from "@/lib/db/schema";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import { pseudonymizeSin, withLuhnCheckDigit } from "@/lib/pii/sin";
import { ingest } from "@/lib/pipeline/ingest";
import { revalidateOffline } from "@/lib/pipeline/revalidate";
import { runBatch } from "@/lib/pipeline/run";
import type { IsoDate } from "@/types";
import { GOLDEN_DIR, goldenInput } from "../helpers/fixtures";
import { ADMIN, api, expectErrorEnvelope, REVIEWER, SUB_0235, SUB_0359, upload } from "../helpers/qa-api";
import { createTestContext, type TestContext } from "../helpers/test-context";

/** Architecture section 17 Phase 2 acceptance criteria AC2-AC5 plus the Phase 2 API surface (section 11). */

let t: TestContext;
let mixed: string;
const happy: Record<string, string> = {};
const EXEC: IsoDate = "2026-10-08";
const B40_REASON = "The member received a promotion";
const B33_REASON = "Reported service does not include service for contributory leave.";

const lakeFile = (root: string, rel: string) => readFileSync(path.join(root, ...rel.split("/")));
const golden = (s: string, f: string) => readFileSync(path.join(GOLDEN_DIR, s, f));
const findingsOf = (batchId: string) => t.ctx.db.select().from(validationFindings).where(eq(validationFindings.batchId, batchId));
const recordsOf = (batchId: string) => t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, batchId));
async function located(ctx: TestContext, batchId: string) {
  const [b] = await ctx.ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  return { b, paths: lakePaths({ employerId: b.employerId, batchId, ingestDate: ingestDateOf(b.receivedAt) }) };
}
const body = (o: unknown) => JSON.stringify(o);

beforeAll(async () => {
  t = await createTestContext();
  mixed = (await upload(goldenInput("mixed-100-rows"), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "mixed.csv" })).body.batchId;
  for (const s of ["happy-terfin", "happy-decfin", "happy-retfin"]) happy[s] = (await upload(goldenInput(s), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: `${s}.csv` })).body.batchId;
});
afterAll(() => t.cleanup());

describe("Phase 2 AC2: determinism", () => {
  it("silver/findings.ndjson is byte-identical to the checked-in expectation and to a second run in a fresh context", async () => {
    const { b, paths: p } = await located(t, mixed);
    expect(b.status).toBe("VALIDATED");
    const first = lakeFile(t.lakeRoot, p.silver.findings);
    expect(first.equals(golden("mixed-100-rows", "expected-findings.ndjson"))).toBe(true);
    const t2 = await createTestContext();
    try {
      const r = await ingest(t2.ctx, { bytes: goldenInput("mixed-100-rows"), filename: "again.csv", employerId: "0235", submittedBy: "user:other", executionDate: EXEC });
      expect(await runBatch(t2.ctx, r.batchId)).toBe("VALIDATED");
      const { b: b2, paths: p2 } = await located(t2, r.batchId);
      expect(lakeFile(t2.lakeRoot, p2.silver.findings).equals(first)).toBe(true);
      expect(b2.arielSnapshotHash).toBe(b.arielSnapshotHash);
      expect(b2.rulesConfigHash).toBe(b.rulesConfigHash);
    } finally {
      await t2.cleanup();
      setAppContextForTests(t.ctx);
    }
    for (const s of Object.keys(happy)) {
      const { paths: hp } = await located(t, happy[s]);
      expect(lakeFile(t.lakeRoot, hp.silver.findings).equals(golden(s, "expected-findings.ndjson")), s).toBe(true);
    }
  });
  it("the persisted Ariel snapshot hashes to the value stamped on the batch and is downloadable by HOOPP roles only", async () => {
    const { b, paths: p } = await located(t, mixed);
    const snap = lakeFile(t.lakeRoot, p.silver.arielSnapshot);
    const { sha256Hex } = await import("@/lib/crypto/hash");
    expect(sha256Hex(snap)).toBe(b.arielSnapshotHash);
    expect(snap.toString("utf8")).not.toMatch(/"9000\d{5}"/);
    const r = await api.report(REVIEWER, mixed, "ariel-snapshot.ndjson");
    expect(r.status).toBe(200);
    expect(Buffer.from(r.text, "utf8").equals(snap)).toBe(true);
    expectErrorEnvelope(await api.report(SUB_0235, mixed, "ariel-snapshot.ndjson"), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.report(SUB_0235, mixed, "rules-config.json"), 403, "FORBIDDEN");
    expect((await api.report(ADMIN, mixed, "rules-config.json")).body.hash).toBe(b.rulesConfigHash);
    const detail = await api.getBatch(SUB_0235, mixed);
    expect(detail.body.reports.map((x: { name: string }) => x.name)).not.toContain("summary-of-validations.private.csv");
    expect(detail.body.reports.map((x: { name: string }) => x.name)).toContain("summary-of-validations.csv");
    expect((await api.getBatch(REVIEWER, mixed)).body.reports.map((x: { name: string }) => x.name)).toContain("summary-of-validations.private.csv");
  });
});

describe("Phase 2 AC3: seed outcomes", () => {
  it("M4/M5/M6 are rejected by B5 with the right event types; M1/M2/M3 (happy files) pass with zero findings", async () => {
    const f = await findingsOf(mixed);
    const recs = await recordsOf(mixed);
    const at = (line: number) => ({ rec: recs.find((r) => r.lineNumber === line)!, b5: f.find((x) => x.lineNumber === line && x.ruleId === "B5")! });
    expect(at(59).rec.eventType).toBe("TERFIN");
    expect(at(59).b5.calculated).toMatchObject({ reason: "ALREADY_TERMINATED", terminationCode: "TER" });
    expect(at(60).rec.eventType).toBe("RETFIN");
    expect(at(60).b5.calculated).toMatchObject({ reason: "TERMINATION_CODE_DEC" });
    expect(at(61).rec.eventType).toBe("RETFIN");
    expect(at(61).b5.calculated).toMatchObject({ reason: "RET_WITH_CTSRV_IN_YEAR", year: 2026 });
    for (const line of [59, 60, 61]) expect(at(line).rec.outcome, `line ${line}`).toBe("REJECTED");
    for (const [s, id] of Object.entries(happy)) {
      const d = await api.getBatch(REVIEWER, id);
      expect(d.body.status, s).toBe("VALIDATED");
      expect(d.body.counts, s).toMatchObject({ accepted: d.body.counts.rows, rejected: 0, held: 0, warnings: 0, infos: 0 });
      expect(await findingsOf(id), s).toHaveLength(0);
    }
  });
});

describe("Phase 2 AC4: warning override", () => {
  it("HELD row -> listed reason -> ACCEPTED, WarningOverridden + MemberRecordValidated ledgered; unlisted reason 422; Submitter 403", async () => {
    const f = (await findingsOf(mixed)).find((x) => x.lineNumber === 77 && x.ruleId === "B40")!;
    expect((await api.getBatch(REVIEWER, mixed)).body.counts).toMatchObject({ held: 8, accepted: 19 });
    expectErrorEnvelope(await api.override(REVIEWER, f.findingId, body({ reason: "Because" })), 422, "REASON_NOT_ALLOWED");
    expectErrorEnvelope(await api.override(REVIEWER, f.findingId, body({ reason: "Other - please provide explanation" })), 422, "NOTE_REQUIRED");
    expectErrorEnvelope(await api.override(SUB_0235, f.findingId, body({ reason: B40_REASON })), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.override({}, f.findingId, body({ reason: B40_REASON })), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.override(REVIEWER, f.findingId, "{}"), 400);
    const ok = await api.override(REVIEWER, f.findingId, body({ reason: B40_REASON }));
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ rowOutcome: "ACCEPTED", heldRemaining: 7 });
    expect(ok.body.finding.override).toMatchObject({ reason: B40_REASON, actor: "user:qa-rev", ledgerSeq: ok.body.ledgerSeq });
    expectErrorEnvelope(await api.override(REVIEWER, f.findingId, body({ reason: B40_REASON })), 409, "ALREADY_OVERRIDDEN");
    const rec = (await recordsOf(mixed)).find((r) => r.lineNumber === 77)!;
    expect(rec.outcome).toBe("ACCEPTED");
    expect(rec.accepted).toBe(true);
    expect((await api.getBatch(REVIEWER, mixed)).body.counts).toMatchObject({ held: 7, accepted: 20, rejected: 73 });
    expect((await api.getBatch(REVIEWER, mixed)).body.status).toBe("VALIDATED");
    const over = await t.ctx.ledger.list({ batchId: mixed, eventType: "WarningOverridden", limit: 50 });
    expect(over.items).toHaveLength(1);
    expect(over.items[0].streamId).toBe(`member:${rec.sinPseudo}`);
    expect(over.items[0].actor).toBe("user:qa-rev");
    expect(over.items[0].payload).toMatchObject({ findingId: f.findingId, ruleId: "B40", messageId: "1238", yearScope: "CURRENT", reason: B40_REASON, rowOutcome: "ACCEPTED", lineNumber: 77 });
    const validated = await t.ctx.ledger.list({ streamId: `member:${rec.sinPseudo}`, eventType: "MemberRecordValidated", limit: 50 });
    expect(validated.items).toHaveLength(1);
    expect(validated.items[0].payload).toMatchObject({ lineNumber: 77, overrides: [{ findingId: f.findingId, ruleId: "B40", reason: B40_REASON }] });
    expect((validated.items[0].payload as { findings: Array<{ ruleId: string }> }).findings.map((x) => x.ruleId)).toEqual(["B40"]);
    expect(JSON.stringify(over.items[0].payload)).not.toMatch(/"9000\d{5}"/);
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
    expect((await api.findings(REVIEWER, mixed, "?override=done&limit=200")).body.items.map((x: { findingId: string }) => x.findingId)).toEqual([f.findingId]);
    // "pending" is a findings filter: warnings on rejected rows count too (the row is REJECTED regardless).
    const pendingWarnings = (await findingsOf(mixed)).filter((x) => x.severity === "WARNING" && !x.overrideReason).length;
    expect(pendingWarnings).toBe(15);
    expect((await api.findings(REVIEWER, mixed, "?override=pending&limit=200")).body.items).toHaveLength(pendingWarnings);
    expect((await api.records(REVIEWER, mixed, "?accepted=held&limit=200")).body.items).toHaveLength(7);
    expect((await t.ctx.db.select().from(auditLog)).some((a) => a.action === "OVERRIDE_WARNING" && a.target === `finding:${f.findingId}`)).toBe(true);
  });
  it("ALLOW_SUBMITTER_OVERRIDE lets the employer override its own rows only; CME / unknown / wrong-batch findings are refused", async () => {
    const f = (await findingsOf(mixed)).find((x) => x.lineNumber === 67 && x.ruleId === "B139")!;
    const cfg = t.ctx.config as { allowSubmitterOverride: boolean };
    cfg.allowSubmitterOverride = true;
    try {
      expectErrorEnvelope(await api.override(SUB_0359, f.findingId, body({ reason: f.overrideReasons[0] })), 404, "NOT_FOUND");
      const ok = await api.batchOverride(SUB_0235, mixed, f.findingId, body({ reason: f.overrideReasons[0] }));
      expect(ok.status, ok.text).toBe(200);
      expect(ok.body.rowOutcome).toBe("ACCEPTED");
    } finally {
      cfg.allowSubmitterOverride = false;
    }
    const cme = (await findingsOf(mixed)).find((x) => x.lineNumber === 57 && x.ruleId === "B204")!;
    expectErrorEnvelope(await api.override(REVIEWER, cme.findingId, body({ reason: "x" })), 422, "NOT_OVERRIDABLE");
    expectErrorEnvelope(await api.override(REVIEWER, "00000000-0000-7000-8000-00000000beef", body({ reason: "x" })), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.override(REVIEWER, "nope", body({ reason: "x" })), 400);
    const other = (await findingsOf(mixed)).find((x) => x.lineNumber === 78 && x.ruleId === "B40")!;
    expectErrorEnvelope(await api.batchOverride(REVIEWER, happy["happy-terfin"], other.findingId, body({ reason: B40_REASON })), 404, "NOT_FOUND");
  });
  it("bulk override: one reason for several findings; partial failures are 207, total failure 422, Submitter 403", async () => {
    const all = await findingsOf(mixed);
    const b33 = all.filter((x) => x.lineNumber === 74 && x.ruleId === "B33").map((x) => x.findingId);
    expect(b33).toHaveLength(2);
    expectErrorEnvelope(await api.bulkOverride(SUB_0235, mixed, body({ findingIds: b33, reason: B33_REASON })), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.bulkOverride(SUB_0359, mixed, body({ findingIds: b33, reason: B33_REASON })), 404, "NOT_FOUND");
    const ok = await api.bulkOverride(REVIEWER, mixed, body({ findingIds: b33, reason: B33_REASON }));
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.results.map((r: { ok: boolean; rowOutcome?: string }) => [r.ok, r.rowOutcome])).toEqual([[true, "HELD"], [true, "ACCEPTED"]]);
    expect(ok.body.heldRemaining).toBe(5);
    expect((await recordsOf(mixed)).find((r) => r.lineNumber === 74)?.outcome).toBe("ACCEPTED");
    const cme = all.find((x) => x.lineNumber === 57 && x.ruleId === "B204")!.findingId;
    const b40 = all.find((x) => x.lineNumber === 78 && x.ruleId === "B40")!.findingId;
    const partial = await api.bulkOverride(ADMIN, mixed, body({ findingIds: [cme, b40], reason: B40_REASON }));
    expect(partial.status).toBe(207);
    expect(partial.body.results.map((r: { ok: boolean }) => r.ok)).toEqual([false, true]);
    expect(partial.body.results[0]).toMatchObject({ status: 422, code: "NOT_OVERRIDABLE" });
    const none = await api.bulkOverride(ADMIN, mixed, body({ findingIds: [cme], reason: B40_REASON }));
    expectErrorEnvelope(none, 422, "NO_OVERRIDE_APPLIED");
    expect(none.body.error.details.results[0]).toMatchObject({ ok: false, code: "NOT_OVERRIDABLE" });
    expect((await t.ctx.ledger.list({ batchId: mixed, eventType: "WarningOverridden", limit: 50 })).items).toHaveLength(5);
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
  });
  it("Summary of Validations: public CSV hides PRIVATE rows, private CSV shows them, overrides are counted, formula cells are neutralised", async () => {
    const pub = await api.report(SUB_0235, mixed, "summary-of-validations.csv");
    expect(pub.status).toBe(200);
    expect(pub.headers.get("content-type")).toContain("text/csv");
    const lines = pub.text.trim().split("\r\n");
    expect(lines[0]).toBe("Section,Rule,MessageID,Level,Severity,Findings,Rows,Overridden,PortalMessage");
    expect(pub.text).not.toMatch(/\bB41\b|\bB44\b|\bB182\b|PRIVATE/);
    const b40Row = lines.find((l) => l.startsWith("BUSINESS,B40,"))!;
    expect(b40Row.split(",").slice(0, 8)).toEqual(["BUSINESS", "B40", "1238", "L2", "WARNING", "3", "3", "2"]);
    expect(lines.find((l) => l.startsWith("FILE_FORMAT,I1,"))).toBeTruthy();
    expectErrorEnvelope(await api.report(SUB_0235, mixed, "summary-of-validations.private.csv"), 403, "FORBIDDEN");
    const priv = await api.report(REVIEWER, mixed, "summary-of-validations.private.csv");
    expect(priv.status).toBe(200);
    expect(priv.text.split("\r\n")[0]).toBe("Section,Rule,MessageID,Level,Severity,Visibility,Findings,Rows,Overridden,PortalMessage");
    expect(priv.text).toMatch(/BUSINESS,B41,6065,L2,INFORMATION,PRIVATE,/);
    expect(priv.text).toMatch(/BUSINESS,B182,9810,L2,INFORMATION,PRIVATE,/);
    const { buildSummaryOfValidationsCsv } = await import("@/lib/pipeline/summary-report");
    const { toFinding } = await import("@/lib/queries/findings");
    const injected = (await findingsOf(mixed)).slice(0, 1).map(toFinding).map((f) => ({ ...f, portalMessage: "=HYPERLINK(\"http://x\")" }));
    expect(buildSummaryOfValidationsCsv(injected, { includePrivate: false })).toMatch(/,"'=HYPERLINK/);
  });
});

describe("Phase 2 AC5: offline re-validation", () => {
  it("re-running the engine from the persisted raw file + snapshot + config reproduces findings.ndjson byte-for-byte, even after the live config changed", async () => {
    const { b, paths: p } = await located(t, mixed);
    const r = await revalidateOffline(t.ctx, mixed);
    expect(r.findingsNdjson).toBe(lakeFile(t.lakeRoot, p.silver.findings).toString("utf8"));
    expect(r.rulesConfigHash).toBe(b.rulesConfigHash);
    expect(r.arielSnapshotHash).toBe(b.arielSnapshotHash);
    expect(r.counts).toEqual({ accepted: 19, rejected: 73, held: 8, findings: 116 });
    const patched = await api.patchRule(ADMIN, "B40", body({ tolerances: { "B40.pct": 0.5 }, reason: "AC5: live change must not affect persisted batches" }));
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.config.hash).not.toBe(b.rulesConfigHash);
    try {
      const again = await revalidateOffline(t.ctx, mixed);
      expect(again.findingsNdjson).toBe(r.findingsNdjson);
      expect(again.rulesConfigHash).toBe(b.rulesConfigHash);
    } finally {
      expect((await api.deleteRule(ADMIN, "B40", "AC5 cleanup")).status).toBe(200);
    }
    expect((await api.rules()).body.config.hash).toBe(b.rulesConfigHash);
  });
});

describe("Phase 2: rules configuration API", () => {
  it("PATCH/DELETE are Admin-only and validated; changes are ledgered on the system stream, audit-logged and stamped on later batches", async () => {
    const fileHash = (await api.rules()).body.config.hash as string;
    expectErrorEnvelope(await api.patchRule(REVIEWER, "B181", body({ enabled: true, reason: "nope" })), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.patchRule(SUB_0235, "B181", body({ enabled: true, reason: "nope" })), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.patchRule({}, "B181", body({ enabled: true, reason: "nope" })), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.patchRule(ADMIN, "NOPE", body({ enabled: true, reason: "unknown rule" })), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B40", body({ tolerances: { "B43.amount": 1 }, reason: "wrong rule" })), 422, "UNKNOWN_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B31", body({ tolerances: { "B31.windowStart": "nope" }, reason: "bad format" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B40", body({ tolerances: { "B40.pct": "x" }, reason: "bad type" })), 422, "INVALID_TOLERANCE");
    expectErrorEnvelope(await api.patchRule(ADMIN, "B40", body({ reason: "nothing" })), 400);
    expectErrorEnvelope(await api.patchRule(ADMIN, "B40", body({ enabled: false })), 400);
    const on = await api.patchRule(ADMIN, "B181", body({ enabled: true, reason: "re-enable for test" }));
    expect(on.status, on.text).toBe(200);
    expect(on.body.rule).toMatchObject({ id: "B181", enabled: true, enabledByDefault: false, overridden: true });
    expect(on.body.changes).toEqual([{ ruleId: "B181", key: "enabled", from: false, to: true }]);
    expect(typeof on.body.ledgerSeq).toBe("number");
    expect(on.body.config.hash).not.toBe(fileHash);
    const noop = await api.patchRule(ADMIN, "B181", body({ enabled: true, reason: "same again" }));
    expect(noop.body).toMatchObject({ changes: [], ledgerSeq: null });
    const tol = await api.patchRule(ADMIN, "B37", body({ tolerances: { "B37.tolerance1Weeks": 3 }, reason: "tolerance" }));
    expect(tol.body.rule.tolerances.find((x: { key: string }) => x.key === "B37.tolerance1Weeks").value).toBe(3);
    const hist = await api.rulesHistory(REVIEWER);
    expect(hist.status).toBe(200);
    expect(hist.body.items[0]).toMatchObject({ eventType: "RulesConfigChanged", streamId: "system", actor: "user:qa-admin" });
    expect(hist.body.items[0].payload).toMatchObject({ reason: "tolerance", changes: [{ ruleId: "B37", key: "B37.tolerance1Weeks", from: 2, to: 3 }] });
    expect(hist.body.items.map((e: { payload: { reason: string } }) => e.payload.reason)).toContain("re-enable for test");
    expectErrorEnvelope(await api.rulesHistory(SUB_0235), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.rulesHistory({}), 401, "UNAUTHENTICATED");
    const current = (await api.rules()).body.config.hash as string;
    const u = await upload(goldenInput("happy-terfin"), ADMIN, { employerId: "0135", executionDate: EXEC }, { filename: "stamped.csv" });
    expect(u.body.status).toBe("VALIDATED");
    expect((await api.getBatch(ADMIN, u.body.batchId)).body.rulesConfigHash).toBe(current);
    expect((await api.report(ADMIN, u.body.batchId, "rules-config.json")).body).toMatchObject({ hash: current, enabled: { B181: true }, tolerances: { "B37.tolerance1Weeks": 3 } });
    expectErrorEnvelope(await api.deleteRule(REVIEWER, "B181"), 403, "FORBIDDEN");
    const off = await api.deleteRule(ADMIN, "B181", "back to default");
    expect(off.status).toBe(200);
    expect(off.body.rule).toMatchObject({ enabled: false, overridden: false });
    expect((await api.deleteRule(ADMIN, "B37")).status).toBe(200);
    expect((await api.rules()).body.config.hash).toBe(fileHash);
    expect((await api.deleteRule(ADMIN, "B37")).body.ledgerSeq).toBeNull();
    expect((await t.ctx.db.select().from(auditLog)).filter((a) => a.action === "RULES_CONFIG_CHANGED").length).toBeGreaterThanOrEqual(2);
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
  });
});

describe("Phase 2: mock Ariel read API", () => {
  it("members/rates/reseed follow the section 13 role matrix and never expose a raw SIN", async () => {
    expectErrorEnvelope(await api.arielMembers(SUB_0235), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.arielMembers({}), 401, "UNAUTHENTICATED");
    const list = await api.arielMembers(REVIEWER, "?employerId=0235&q=ABLE");
    expect(list.status).toBe(200);
    expect(list.body.adapter).toBe("MockArielAdapter");
    expect(list.body.items.some((m: { scenario: string | null }) => m.scenario?.startsWith("M1 "))).toBe(true);
    expect(list.text).not.toMatch(/"9000\d{5}"/);
    expect(list.body.items[0].sinMasked).toMatch(/^\*\*\*-\*\*\*-\d{3}$/);
    const all = await api.arielMembers(ADMIN);
    expect(all.body.items.length).toBeGreaterThanOrEqual(19);
    expect(all.body.items.filter((m: { duplicateSin: boolean }) => m.duplicateSin)).toHaveLength(2);
    expect((await api.arielMembers(ADMIN, "?employerId=9999")).body.items).toEqual([]);
    const key = t.ctx.config.sinPseudonymKey;
    const one = await api.arielMember(ADMIN, pseudonymizeSin(key, "900000019"));
    expect(one.status).toBe(200);
    expect(one.body.members).toHaveLength(1);
    expect(one.body.members[0]).toMatchObject({ sinMasked: "***-***-019", lastName: "ABLE" });
    expect(one.body.members[0].employments[0].service.length).toBeGreaterThan(0);
    expect(one.text).not.toContain("900000019");
    expect((await api.arielMember(ADMIN, pseudonymizeSin(key, withLuhnCheckDigit("90000018")))).body.members).toHaveLength(2);
    expectErrorEnvelope(await api.arielMember(ADMIN, "not-a-pseudonym"), 400);
    expectErrorEnvelope(await api.arielMember(ADMIN, "0".repeat(64)), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.arielMember(SUB_0235, pseudonymizeSin(key, "900000019")), 403, "FORBIDDEN");
    const rates = await api.arielRates(SUB_0235);
    expect(rates.status).toBe(200);
    expect(rates.body.rows.every((r: { placeholder: boolean }) => r.placeholder === true)).toBe(true);
    expect(rates.body.rows.find((r: { table: string; year: number }) => r.table === "MGA" && r.year === 2026)?.value).toBe("74600");
    expect(new Set(rates.body.rows.map((r: { table: string }) => r.table))).toEqual(new Set(["MGA", "PAMAXDB", "REDFE", "LOWRATE", "HIGHRATE"]));
    expectErrorEnvelope(await api.arielRates({}), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.arielReseed(REVIEWER), 403, "FORBIDDEN");
    const reseed = await api.arielReseed(ADMIN);
    expect(reseed.status, reseed.text).toBe(200);
    expect(reseed.body.ok).toBe(true);
    expect(reseed.body.members).toBeGreaterThanOrEqual(19);
    expect((await api.arielMember(ADMIN, pseudonymizeSin(key, "900000019"))).status).toBe(200);
    expect((await t.ctx.db.select().from(auditLog)).some((a) => a.action === "ARIEL_MOCK_RESEED" || a.action === "MOCK_RESEED" || a.action.includes("RESEED"))).toBe(true);
  });
});
