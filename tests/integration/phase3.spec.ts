import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";
import { approvals, arielUpdateItems, arielUpdateSets, auditLog, batches, exports as exportsTable } from "@/lib/db/schema";
import { decodeBytes } from "@/lib/events/decode";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import { dumpProjections, rebuildProjections } from "@/lib/projection";
import { GOLDEN_DIR, goldenInput } from "../helpers/fixtures";
import { ADMIN, api, expectErrorEnvelope, REVIEWER, SUB_0235, SUB_0359, upload } from "../helpers/qa-api";
import { createTestContext, type TestContext } from "../helpers/test-context";

/** Architecture section 17 Phase 3 AC1-AC4, AC6 + the section 11 approval/export API surface. */
let t: TestContext;
const EXEC = "2026-10-08";
const happy: Record<string, string> = {};
const body = (o: unknown) => JSON.stringify(o);
const golden = (s: string, f: string) => readFileSync(path.join(GOLDEN_DIR, s, f));
const lakeFile = (rel: string) => readFileSync(path.join(t.lakeRoot, ...rel.split("/")));
const mixedLine = (n: number) => {
  const text = decodeBytes(goldenInput("mixed-100-rows")).text.split(/\r?\n/);
  return Buffer.from(text[0] + "\r\n" + text[n - 1] + "\r\n", "latin1");
};
const happyLine = (s: string, n: number) => decodeBytes(goldenInput(s)).text.split(/\r?\n/)[n - 1];
const csvOf = (...rows: string[]) => Buffer.from([decodeBytes(goldenInput("mixed-100-rows")).text.split(/\r?\n/)[0], ...rows].join("\r\n") + "\r\n", "latin1");
async function located(batchId: string) {
  const [b] = await t.ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  return { b, paths: lakePaths({ employerId: b.employerId, batchId, ingestDate: ingestDateOf(b.receivedAt) }) };
}
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const APPROVE_NOTE = "Reviewed derived changes; split formulas verified.";

beforeAll(async () => {
  t = await createTestContext();
  for (const s of ["happy-terfin", "happy-decfin", "happy-retfin"]) happy[s] = (await upload(goldenInput(s), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: `${s}.csv` })).body.batchId;
});
afterAll(() => t.cleanup());

describe("Phase 3 AC1: golden update sets", () => {
  it("happy-terfin / happy-decfin / happy-retfin produce the checked-in ariel-update-set.json byte-for-byte and reach PENDING_APPROVAL", async () => {
    for (const s of Object.keys(happy)) {
      const { b, paths } = await located(happy[s]);
      expect(b.status, s).toBe("PENDING_APPROVAL");
      expect(b.updateSetId, s).toBeTruthy();
      const gold = lakeFile(paths.gold.updateSetJson);
      expect(gold.equals(golden(s, "ariel-update-set.json")), `${s} gold json`).toBe(true);
      const expected = JSON.parse(golden(s, "expected-update-counts.json").toString("utf8"));
      const [set] = await t.ctx.db.select().from(arielUpdateSets).where(eq(arielUpdateSets.updateSetId, b.updateSetId!));
      expect(set).toMatchObject({ status: "PENDING_APPROVAL", contentHash: expected.contentHash, itemCount: expected.itemCount, memberCount: expected.memberCount, buildNo: 1 });
      for (const p of [paths.gold.updateSetCsv, paths.gold.diffMd, paths.gold.modifiedFieldsReport, paths.gold.transactionsReport, paths.gold.transactionsSummary]) expect(await t.ctx.lake.exists(p), p).toBe(true);
      expect(gold.toString("utf8")).not.toMatch(/"9000\d{5}"/);
      // UpdateSetBuilt attests the artifacts.
      const built = await t.ctx.ledger.list({ batchId: happy[s], eventType: "UpdateSetBuilt" });
      expect(built.items).toHaveLength(1);
      expect(built.items[0].payload).toMatchObject({ updateSetId: b.updateSetId, contentHash: expected.contentHash, itemCount: expected.itemCount, buildNo: 1 });
      expect((built.items[0].payload as { artifactHashes: Record<string, string> }).artifactHashes.json).toBe(sha256Hex(gold));
    }
  });
  it("ArielUpdateProposed per accepted row carries itemsHash + counts and no PII beyond the masked SIN; items reference it", async () => {
    const { b } = await located(happy["happy-terfin"]);
    const proposed = await t.ctx.ledger.list({ batchId: b.batchId, eventType: "ArielUpdateProposed", order: "asc" });
    expect(proposed.items).toHaveLength(5);
    const items = await t.ctx.db.select().from(arielUpdateItems).where(eq(arielUpdateItems.updateSetId, b.updateSetId!));
    expect(items).toHaveLength(50);
    for (const e of proposed.items) {
      expect(e.streamId).toMatch(/^member:[0-9a-f]{64}$/);
      expect(e.payload).toMatchObject({ employerId: "0235", eventType: "TERFIN", arielSnapshotHash: b.arielSnapshotHash });
      expect((e.payload as { itemsHash: string }).itemsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(e.payload)).not.toMatch(/ABLE|Anna|9000\d{5}/);
      const mine = items.filter((i) => i.ledgerEntryId === e.entryId);
      expect(mine.length).toBe((e.payload as { itemCount: number }).itemCount);
    }
  });
});

describe("Phase 3 API: GET update-set", () => {
  it("Reviewer/Admin get members -> record-type groups with contentHash and counts; filters work; Submitters are refused", async () => {
    const id = happy["happy-terfin"];
    const r = await api.updateSet(REVIEWER, id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.updateSet).toMatchObject({ status: "PENDING_APPROVAL", itemCount: 50, memberCount: 5 });
    expect(r.body.updateSet.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.updateSet.counts.byRecordType.Employment).toBe(20);
    expect(r.body.members).toHaveLength(5);
    expect(r.body.members[0].groups[0].recordType).toBe("Employment");
    expect(r.body.members[0].groups[0].items[0]).toMatchObject({ derivationRule: "D-EMP-TERMDATE", operation: "UPDATE" });
    expect(r.body.batch).toMatchObject({ status: "PENDING_APPROVAL", heldRows: 0 });
    expect(r.body.isCurrent).toBe(true);
    const pa = await api.updateSet(ADMIN, id, "?recordType=PlansTaxInfoPA");
    expect(pa.body.filteredItemCount).toBe(5);
    expect(pa.body.members.every((m: { groups: Array<{ recordType: string }> }) => m.groups.length === 1 && m.groups[0].recordType === "PlansTaxInfoPA")).toBe(true);
    const paged = await api.updateSet(ADMIN, id, "?limit=2");
    expect(paged.body.members).toHaveLength(2);
    expect(paged.body.nextCursor).toBeTruthy();
    const next = await api.updateSet(ADMIN, id, `?limit=2&cursor=${encodeURIComponent(paged.body.nextCursor)}`);
    expect(next.body.members[0].sinPseudo).not.toBe(paged.body.members[0].sinPseudo);
    const byId = await api.updateSetById(REVIEWER, r.body.updateSet.updateSetId);
    expect(byId.status).toBe(200);
    expect(byId.body.updateSet.contentHash).toBe(r.body.updateSet.contentHash);
    expectErrorEnvelope(await api.updateSet(SUB_0235, id), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.updateSet({}, id), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.updateSet(ADMIN, "00000000-0000-7000-8000-00000000dead"), 404, "NOT_FOUND");
    const diff = await api.updateSetDiff(REVIEWER, id);
    expect(diff.status).toBe(200);
    expect(diff.headers.get("content-type")).toContain("text/markdown");
    expect(diff.text).toContain("D-EMP-TERMDATE");
    // Phase 3 gold reports are HOOPP-only.
    expect((await api.report(REVIEWER, id, "modified-fields-report.csv")).status).toBe(200);
    expect((await api.report(REVIEWER, id, "transactions-summary.csv")).text).toContain("items-by-record-type");
    expectErrorEnvelope(await api.report(SUB_0235, id, "ariel-update-set.json"), 403, "FORBIDDEN");
    const detail = await api.getBatch(SUB_0235, id);
    expect(detail.body.updateSet).toMatchObject({ status: "PENDING_APPROVAL", itemCount: 50 });
    expect(detail.body.reports.map((x: { name: string }) => x.name)).not.toContain("ariel-update-set.json");
  });
});

describe("Phase 3 AC2: approve / export", () => {
  it("stale contentHash -> 409; invalid bodies -> 400; Submitter -> 403; approve -> APPROVED + ledger + audit; export -> files whose sha256 match exports row and ledger; Admin download audit-logged", async () => {
    const id = happy["happy-terfin"];
    const current = (await api.updateSet(REVIEWER, id)).body.updateSet.contentHash as string;
    const stale = "0".repeat(64);
    expectErrorEnvelope(await api.approve(REVIEWER, id, body({ contentHash: stale, note: APPROVE_NOTE, attest: true })), 409, "STALE_CONTENT_HASH");
    expectErrorEnvelope(await api.approve(REVIEWER, id, body({ contentHash: current, note: "short", attest: true })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.approve(REVIEWER, id, body({ contentHash: current, note: APPROVE_NOTE })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.approve(SUB_0235, id, body({ contentHash: current, note: APPROVE_NOTE, attest: true })), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.exportSet(REVIEWER, id), 422, "BATCH_NOT_APPROVED");
    const ok = await api.approve(REVIEWER, id, body({ contentHash: current, note: APPROVE_NOTE, attest: true }));
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ batchStatus: "APPROVED", approval: { decision: "APPROVED", actor: "user:qa-rev", role: "Reviewer", contentHashAtDecision: current } });
    expect((await api.getBatch(SUB_0235, id)).body).toMatchObject({ status: "APPROVED", approval: { actor: "user:qa-rev" } });
    const appr = await t.ctx.ledger.list({ batchId: id, eventType: "UpdateSetApproved" });
    expect(appr.items).toHaveLength(1);
    expect(appr.items[0].payload).toMatchObject({ contentHash: current, note: APPROVE_NOTE, role: "Reviewer" });
    expect((await t.ctx.db.select().from(auditLog).where(eq(auditLog.action, "APPROVE_UPDATE_SET"))).length).toBe(1);
    expectErrorEnvelope(await api.approve(REVIEWER, id, body({ contentHash: current, note: APPROVE_NOTE, attest: true })), 422, "BATCH_NOT_PENDING");
    expectErrorEnvelope(await api.reject(REVIEWER, id, body({ contentHash: current, reason: "too late" })), 422, "BATCH_NOT_PENDING");

    expectErrorEnvelope(await api.exportSet(SUB_0235, id), 403, "FORBIDDEN");
    const ex = await api.exportSet(REVIEWER, id, body({ format: "both" }));
    expect(ex.status, ex.text).toBe(200);
    expect(ex.body.batchStatus).toBe("EXPORTED");
    const exp = ex.body.export;
    expect(exp.files.map((f: { name: string }) => f.name)).toEqual(["ariel-update-set.json", "ariel-update-set.csv", "export-manifest.json"]);
    const [row] = await t.ctx.db.select().from(exportsTable).where(eq(exportsTable.exportId, exp.exportId));
    const exported = await t.ctx.ledger.list({ batchId: id, eventType: "UpdateSetExported" });
    expect(exported.items).toHaveLength(1);
    const ledgerFiles = (exported.items[0].payload as { files: Array<{ name: string; sha256: string }> }).files;
    for (const f of exp.files) {
      const bytes = lakeFile(f.path);
      expect(sha256Hex(bytes), f.name).toBe(f.sha256);
      expect(ledgerFiles.find((x) => x.name === f.name)?.sha256).toBe(f.sha256);
    }
    expect(row.jsonSha256).toBe(exp.files[0].sha256);
    expect(row.csvSha256).toBe(exp.files[1].sha256);
    expect((await api.getBatch(REVIEWER, id)).body).toMatchObject({ status: "EXPORTED" });
    expect((await api.getBatch(REVIEWER, id)).body.updateSet.exports).toHaveLength(1);
    expectErrorEnvelope(await api.exportSet(REVIEWER, id), 422, "ALREADY_EXPORTED");

    // AC6: raw SIN only inside the export directory (and the Rejected Individuals CSV); download is Admin + audit-logged.
    const json = JSON.parse(lakeFile(exp.files[0].path).toString("utf8"));
    expect(json.members[0].sin).toMatch(/^\d{9}$/);
    expect(json.contentHash).toBe(current);
    expect(lakeFile(exp.files[1].path).toString("utf8").split("\r\n")[1]).toMatch(/^\d{9},/);
    const { paths } = await located(id);
    const exportsRoot = path.join(t.lakeRoot, ...paths.gold.exportsDir.split("/"));
    expect(exp.files[0].path.startsWith(paths.gold.exportsDir)).toBe(true);
    for (const file of walk(t.lakeRoot)) {
      if (file.startsWith(exportsRoot) || file.endsWith("rejected.csv") || file.endsWith("original.csv")) continue;
      expect(readFileSync(file).toString("latin1"), file).not.toMatch(/(?<!\d)9000000(19|76|84)(?!\d)/);
    }
    expectErrorEnvelope(await api.exportDownload(REVIEWER, exp.exportId), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.exportDownload(ADMIN, exp.exportId, "../../etc/passwd"), 400);
    expectErrorEnvelope(await api.exportDownload(ADMIN, exp.exportId, "nope.json"), 404, "NOT_FOUND");
    const dl = await api.exportDownload(ADMIN, exp.exportId);
    expect(dl.status).toBe(200);
    expect(sha256Hex(Buffer.from(dl.text, "utf8"))).toBe(exp.files[0].sha256);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    const audits = await t.ctx.db.select().from(auditLog).where(eq(auditLog.action, "DOWNLOAD_EXPORT"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: "user:qa-admin", target: `export:${exp.exportId}/ariel-update-set.json` });
    expect(JSON.stringify(audits[0].details)).not.toMatch(/9000\d{5}/);
    expect((await api.exportMeta(REVIEWER, exp.exportId)).body.files).toHaveLength(3);
    expectErrorEnvelope(await api.exportMeta(SUB_0235, exp.exportId), 403, "FORBIDDEN");
    expect((await t.ctx.ledger.verify()).ok).toBe(true);
  });
  it("HELD rows keep the batch in VALIDATED with no update set; approve -> 422 HELD_ROWS; the last override builds it", async () => {
    const r = await upload(mixedLine(77), REVIEWER === ADMIN ? ADMIN : ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "held.csv" });
    expect(r.body.status).toBe("VALIDATED");
    const id = r.body.batchId as string;
    expect((await api.getBatch(ADMIN, id)).body.counts.held).toBe(1);
    const us = await api.updateSet(REVIEWER, id);
    expect(us.status).toBe(200);
    expect(us.body.updateSet).toBeNull();
    expect(us.body.batch.heldRows).toBe(1);
    expectErrorEnvelope(await api.approve(REVIEWER, id, body({ contentHash: "0".repeat(64), note: APPROVE_NOTE, attest: true })), 422, "HELD_ROWS");
    const f = (await api.findings(REVIEWER, id)).body.items.find((x: { ruleId: string }) => x.ruleId === "B40");
    const ov = await api.override(REVIEWER, f.findingId, body({ reason: "The member received a promotion" }));
    expect(ov.status, ov.text).toBe(200);
    expect(ov.body.heldRemaining).toBe(0);
    const after = await api.getBatch(REVIEWER, id);
    expect(after.body.status).toBe("PENDING_APPROVAL");
    expect(after.body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RECEIVED", "PARSED", "VALIDATED", "LEDGERED", "PROJECTION_BUILT", "PENDING_APPROVAL"]);
    const view = await api.updateSet(REVIEWER, id);
    expect(view.body.members).toHaveLength(1);
    expect(view.body.members[0].overrides).toEqual([expect.objectContaining({ ruleId: "B40", reason: "The member received a promotion", actor: "user:qa-rev" })]);
  });
});

describe("Phase 3 AC3: reject -> reopen -> rebuild", () => {
  it("reject returns REJECTED with the reason visible to the Submitter; Admin reopen with a changed rules config re-validates and builds a new set with a different contentHash; both UpdateSetBuilt stay on chain", async () => {
    // Row 1 = clean M1; row 2 = mixed line 65 (rejected only by B112).
    const r = await upload(csvOf(happyLine("happy-terfin", 2), decodeBytes(goldenInput("mixed-100-rows")).text.split(/\r?\n/)[64]), ADMIN, { employerId: "0235", executionDate: EXEC }, { filename: "ac3.csv" });
    expect(r.body.status, r.text).toBe("PENDING_APPROVAL");
    const id = r.body.batchId as string;
    expect((await api.getBatch(ADMIN, id)).body.counts).toMatchObject({ accepted: 1, rejected: 1 });
    const first = (await api.updateSet(REVIEWER, id)).body.updateSet;
    expect(first.memberCount).toBe(1);
    expectErrorEnvelope(await api.reject(REVIEWER, id, body({ contentHash: "1".repeat(64), reason: "stale" })), 409, "STALE_CONTENT_HASH");
    expectErrorEnvelope(await api.reject(SUB_0235, id, body({ contentHash: first.contentHash, reason: "nope" })), 403, "FORBIDDEN");
    const rej = await api.reject(REVIEWER, id, body({ contentHash: first.contentHash, reason: "Row 2 should not have been rejected; please review B112." }));
    expect(rej.status, rej.text).toBe(200);
    expect(rej.body.batchStatus).toBe("REJECTED");
    const sub = await api.getBatch(SUB_0235, id);
    expect(sub.body.status).toBe("REJECTED");
    expect(sub.body.rejection).toMatchObject({ actor: "user:qa-rev", reason: "Row 2 should not have been rejected; please review B112." });
    expect(sub.body.updateSet.rejection.reason).toContain("B112");
    expect((await t.ctx.ledger.list({ batchId: id, eventType: "UpdateSetRejected" })).items[0].payload).toMatchObject({ updateSetId: first.updateSetId, contentHash: first.contentHash });
    expectErrorEnvelope(await api.approve(REVIEWER, id, body({ contentHash: first.contentHash, note: APPROVE_NOTE, attest: true })), 422, "BATCH_NOT_PENDING");
    expectErrorEnvelope(await api.reopen(REVIEWER, id, body({ reason: "x" })), 403, "FORBIDDEN");
    expectErrorEnvelope(await api.reopen(ADMIN, happy["happy-decfin"], body({ reason: "not rejected" })), 422, "BATCH_NOT_REJECTED");

    const patched = await api.patchRule(ADMIN, "B112", body({ enabled: false, reason: "AC3: relax B112 for the rebuild" }));
    expect(patched.status, patched.text).toBe(200);
    try {
      const ro = await api.reopen(ADMIN, id, body({ reason: "B112 disabled after review" }));
      expect(ro.status, ro.text).toBe(200);
      expect(ro.body.batchStatus).toBe("PENDING_APPROVAL");
      expect(ro.body.revalidation).toMatchObject({ counts: { accepted: 2, rejected: 0, held: 0 } });
      expect(ro.body.updateSetId).not.toBe(first.updateSetId);
      const second = (await api.updateSet(REVIEWER, id)).body.updateSet;
      expect(second.buildNo).toBe(2);
      expect(second.memberCount).toBe(2);
      expect(second.contentHash).not.toBe(first.contentHash);
      const built = await t.ctx.ledger.list({ batchId: id, eventType: "UpdateSetBuilt", order: "asc" });
      expect(built.items.map((e) => (e.payload as { buildNo: number }).buildNo)).toEqual([1, 2]);
      expect((await t.ctx.ledger.list({ batchId: id, eventType: "BatchReopened" })).items).toHaveLength(1);
      const hist = (await api.getBatch(ADMIN, id)).body.statusHistory.map((h: { toStatus: string }) => h.toStatus);
      expect(hist).toEqual(["RECEIVED", "PARSED", "VALIDATED", "LEDGERED", "PROJECTION_BUILT", "PENDING_APPROVAL", "REJECTED", "VALIDATED", "LEDGERED", "PROJECTION_BUILT", "PENDING_APPROVAL"]);
      // The rejected build is kept, not current; acting on it is refused.
      const old = await api.updateSetById(REVIEWER, first.updateSetId);
      expect(old.body.updateSet.status).toBe("REJECTED");
      expect(old.body.isCurrent).toBe(false);
      expectErrorEnvelope(await api.approveById(REVIEWER, first.updateSetId, body({ contentHash: first.contentHash, note: APPROVE_NOTE, attest: true })), 409, "NOT_CURRENT_UPDATE_SET");
      expect((await t.ctx.db.select().from(approvals).where(eq(approvals.updateSetId, first.updateSetId)))).toHaveLength(1);
      expect((await t.ctx.ledger.verify()).ok).toBe(true);
    } finally {
      await api.deleteRule(ADMIN, "B112", "AC3 cleanup");
    }
  });
});

describe("Phase 3 AC4: member projections", () => {
  it("rebuilding from seq 1 yields identical member_projections rows; pending/exported counters follow the update set lifecycle", async () => {
    const before = await dumpProjections(t.ctx);
    expect(before.length).toBeGreaterThanOrEqual(11);
    const { b } = await located(happy["happy-terfin"]);
    const terfinMembers = new Set((await t.ctx.db.select({ s: arielUpdateItems.sinPseudo }).from(arielUpdateItems).where(eq(arielUpdateItems.updateSetId, b.updateSetId!))).map((x) => x.s));
    const terfin = before.filter((p) => terfinMembers.has(p.sinPseudo));
    expect(terfin.length).toBe(5);
    // M1 (line 2) was resubmitted by the AC3 batch: its latest set is pending there, its terfin items are exported.
    const resubmitted = terfin.filter((p) => p.lastUpdateSet?.batchId !== happy["happy-terfin"]);
    expect(resubmitted).toHaveLength(1);
    expect(resubmitted[0]).toMatchObject({ exportedItems: 10, corrections: 0, lastUpdateSet: { status: "PENDING_APPROVAL" } });
    expect(resubmitted[0].pendingItems).toBeGreaterThan(0);
    expect(resubmitted[0].timeline.filter((e) => e.eventType === "ArielUpdateProposed")).toHaveLength(3);
    for (const p of terfin.filter((p) => p.lastUpdateSet?.batchId === happy["happy-terfin"])) {
      expect(p.lastUpdateSet?.status).toBe("EXPORTED");
      expect(p.pendingItems).toBe(0);
      expect(p.exportedItems).toBeGreaterThan(0);
      expect(p.arielStatus).toMatchObject({ status: "D", subStatus: "NCT", previousStatus: "A", state: "EXPORTED" });
      expect(p.timeline.map((e) => e.eventType)).toEqual(["MemberRecordValidated", "ArielUpdateProposed"]);
      expect(p.latestEvent).toMatchObject({ type: "TERFIN", batchId: happy["happy-terfin"] });
      expect(p.employerIds).toEqual(["0235"]);
      expect(p.lastName).toBeTruthy();
    }
    const run = await rebuildProjections(t.ctx);
    expect(run.fromSeq).toBe(1);
    const after = await dumpProjections(t.ctx);
    expect(after).toEqual(before);
  });
});