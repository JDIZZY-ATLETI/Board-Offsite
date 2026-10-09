import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as listBatches, POST as upload } from "@/app/api/batches/route";
import { GET as getBatch } from "@/app/api/batches/[batchId]/route";
import { GET as getFindings } from "@/app/api/batches/[batchId]/findings/route";
import { GET as getRecords } from "@/app/api/batches/[batchId]/records/route";
import { GET as getReport } from "@/app/api/batches/[batchId]/reports/[name]/route";
import { GET as getRejectedCsv } from "@/app/api/batches/[batchId]/rejected.csv/route";
import { GET as ledgerHead } from "@/app/api/ledger/head/route";
import { GET as ledgerEntries } from "@/app/api/ledger/entries/route";
import { GET as ledgerEntry } from "@/app/api/ledger/entries/[seq]/route";
import { POST as ledgerVerify } from "@/app/api/ledger/verify/route";
import { GET as rules } from "@/app/api/rules/route";
import { createJobRunner, setJobRunnerForTests } from "@/lib/pipeline/jobs";
import type { JobRunner } from "@/lib/pipeline/job-runner";
import { goldenInput } from "../helpers/fixtures";
import { createTestContext, type TestContext } from "../helpers/test-context";

let t: TestContext;
let runner: JobRunner;

const ADMIN = { "x-user-id": "admin1", "x-user-role": "Admin" };
const REVIEWER = { "x-user-id": "rev1", "x-user-role": "Reviewer" };
const SUB_0235 = { "x-user-id": "sub0235", "x-user-role": "EmployerSubmitter", "x-employer-id": "0235" };
const SUB_0359 = { "x-user-id": "sub0359", "x-user-role": "EmployerSubmitter", "x-employer-id": "0359" };

const BASE = "http://localhost/api";
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

function form(bytes: Buffer, fields: Record<string, string>, filename = "events.csv", type = "text/csv"): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], filename, { type }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function post(path: string, headers: Record<string, string>, body: FormData | string) {
  const res = await (path.includes("/ledger/verify") ? ledgerVerify : upload)(
    new Request(`${BASE}${path}`, { method: "POST", headers: typeof body === "string" ? { ...headers, "content-type": "application/json" } : headers, body }),
    params({}),
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

beforeAll(async () => {
  t = await createTestContext();
  runner = createJobRunner(t.ctx);
  setJobRunnerForTests(runner);
});
afterAll(async () => {
  setJobRunnerForTests(null);
  await t.cleanup();
});

describe("GET /api/health", () => {
  it("reports db, lake and ledger head without auth", async () => {
    const res = await health(new Request(`${BASE}/health`), params({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBeTruthy();
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok", lake: "ok", dbDriver: "pglite", ledgerHead: { seq: 0 } });
  });
});

describe("POST /api/batches", () => {
  let terfinBatchId: string;
  let headerRejectedId: string;

  it("requires auth and the right role", async () => {
    expect((await post("/batches", {}, form(goldenInput("happy-terfin"), { employerId: "0235" }))).status).toBe(401);
    const r = await post("/batches", REVIEWER, form(goldenInput("happy-terfin"), { employerId: "0235" }));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });
  it("validates the upload at the boundary", async () => {
    expect((await post("/batches", ADMIN, form(goldenInput("happy-terfin"), { employerId: "0235" }, "events.xlsx"))).status).toBe(415);
    expect((await post("/batches", ADMIN, form(Buffer.from("PK\u0003\u0004zip"), { employerId: "0235" }))).status).toBe(415);
    expect((await post("/batches", ADMIN, form(goldenInput("happy-terfin"), { employerId: "../x" }))).body.error.code).toBe("VALIDATION_ERROR");
    const noFile = new FormData();
    noFile.set("employerId", "0235");
    expect((await post("/batches", ADMIN, noFile)).body.error.code).toBe("FILE_REQUIRED");
  });
  it("a Submitter may only upload for its own employer and may not override executionDate", async () => {
    expect((await post("/batches", SUB_0235, form(goldenInput("happy-terfin"), { employerId: "0359" }))).status).toBe(403);
    expect((await post("/batches", SUB_0235, form(goldenInput("happy-terfin"), { employerId: "0235", executionDate: "2026-10-08" }))).status).toBe(403);
  });
  it("happy-terfin with ?wait=true -> VALIDATED (Admin sets executionDate)", async () => {
    const r = await post("/batches?wait=true", ADMIN, form(goldenInput("happy-terfin"), { employerId: "0235", executionDate: "2026-10-08" }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "VALIDATED", duplicate: false });
    terfinBatchId = r.body.batchId;
  });
  it("duplicate re-upload returns 200 duplicate:true with the same batchId", async () => {
    const r = await post("/batches", SUB_0235, form(goldenInput("happy-terfin"), { employerId: "0235" }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ batchId: terfinBatchId, duplicate: true, sha256: expect.any(String) });
  });
  it("async upload returns 202 and the job runner completes it", async () => {
    const r = await post("/batches", SUB_0235, form(goldenInput("file-rejected-header"), { employerId: "0235" }));
    expect(r.status).toBe(202);
    expect(r.body.status).toBe("RECEIVED");
    headerRejectedId = r.body.batchId;
    await runner.drain();
    const res = await getBatch(new Request(`${BASE}/batches/${headerRejectedId}`, { headers: SUB_0235 }), params({ batchId: headerRejectedId }));
    const body = await res.json();
    expect(body.status).toBe("FILE_REJECTED");
    expect(body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RECEIVED", "FILE_REJECTED"]);
    expect(body.originalFilename).toBe("events.csv");
  });

  describe("reads", () => {
    it("GET /api/batches scopes Submitters to their employer and supports filters", async () => {
      await post("/batches?wait=true", SUB_0359, form(goldenInput("happy-retfin"), { employerId: "0359" }));
      const all = await (await listBatches(new Request(`${BASE}/batches`, { headers: REVIEWER }), params({}))).json();
      expect(all.items.length).toBe(3);
      const mine = await (await listBatches(new Request(`${BASE}/batches`, { headers: SUB_0359 }), params({}))).json();
      expect(mine.items.map((b: { employerId: string }) => b.employerId)).toEqual(["0359"]);
      const spoof = await (await listBatches(new Request(`${BASE}/batches?employerId=0235`, { headers: SUB_0359 }), params({}))).json();
      expect(spoof.items).toHaveLength(1);
      const rejected = await (await listBatches(new Request(`${BASE}/batches?status=FILE_REJECTED`, { headers: ADMIN }), params({}))).json();
      expect(rejected.items.map((b: { batchId: string }) => b.batchId)).toEqual([headerRejectedId]);
      const paged = await (await listBatches(new Request(`${BASE}/batches?limit=1`, { headers: ADMIN }), params({}))).json();
      expect(paged.items).toHaveLength(1);
      expect(paged.nextCursor).toBeTruthy();
      const bad = await listBatches(new Request(`${BASE}/batches?status=NOPE`, { headers: ADMIN }), params({}));
      expect(bad.status).toBe(400);
    });
    it("GET /api/batches/{id} hides other employers' batches from Submitters (404)", async () => {
      expect((await getBatch(new Request(`${BASE}/batches/${terfinBatchId}`, { headers: SUB_0359 }), params({ batchId: terfinBatchId }))).status).toBe(404);
      expect((await getBatch(new Request(`${BASE}/batches/${terfinBatchId}`, { headers: SUB_0235 }), params({ batchId: terfinBatchId }))).status).toBe(200);
      expect((await getBatch(new Request(`${BASE}/batches/not-a-uuid`, { headers: ADMIN }), params({ batchId: "not-a-uuid" }))).status).toBe(400);
    });
    it("GET findings with filters; PRIVATE is HOOPP-only", async () => {
      const all = await (await getFindings(new Request(`${BASE}/batches/${headerRejectedId}/findings`, { headers: SUB_0235 }), params({ batchId: headerRejectedId }))).json();
      expect(all.items).toHaveLength(1);
      expect(all.items[0]).toMatchObject({ ruleId: "I51", messageId: "4887", severity: "FILE_ERROR" });
      const none = await (await getFindings(new Request(`${BASE}/batches/${headerRejectedId}/findings?severity=WARNING`, { headers: SUB_0235 }), params({ batchId: headerRejectedId }))).json();
      expect(none.items).toHaveLength(0);
      const byRule = await (await getFindings(new Request(`${BASE}/batches/${headerRejectedId}/findings?ruleId=I51`, { headers: ADMIN }), params({ batchId: headerRejectedId }))).json();
      expect(byRule.items).toHaveLength(1);
      expect((await getFindings(new Request(`${BASE}/batches/${headerRejectedId}/findings?visibility=PRIVATE`, { headers: SUB_0235 }), params({ batchId: headerRejectedId }))).status).toBe(403);
      expect((await getFindings(new Request(`${BASE}/batches/${headerRejectedId}/findings?visibility=PRIVATE`, { headers: REVIEWER }), params({ batchId: headerRejectedId }))).status).toBe(200);
    });
    it("GET records lists outcomes and masked SINs", async () => {
      const res = await getRecords(new Request(`${BASE}/batches/${terfinBatchId}/records?accepted=true&limit=2`, { headers: SUB_0235 }), params({ batchId: terfinBatchId }));
      const body = await res.json();
      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).toBe("3");
      expect(body.items[0]).toMatchObject({ lineNumber: 2, sinMasked: "***-***-019", eventType: "TERFIN", outcome: "ACCEPTED", findingCounts: { cme: 0 } });
      expect(JSON.stringify(body)).not.toContain("900000019");
    });
    it("GET reports streams artifacts; rejected.csv is audit-logged and rejects unknown names", async () => {
      const rep = await getReport(new Request(`${BASE}/batches/${terfinBatchId}/reports/execution-report.json`, { headers: SUB_0235 }), params({ batchId: terfinBatchId, name: "execution-report.json" }));
      expect(rep.status).toBe(200);
      expect((await rep.json()).status).toBe("VALIDATED");
      const html = await getReport(new Request(`${BASE}/batches/${terfinBatchId}/reports/execution-report.html`, { headers: SUB_0235 }), params({ batchId: terfinBatchId, name: "execution-report.html" }));
      expect(html.headers.get("content-type")).toContain("text/html");
      const csv = await getRejectedCsv(new Request(`${BASE}/batches/${terfinBatchId}/rejected.csv`, { headers: { ...SUB_0235, "x-forwarded-for": "10.0.0.1" } }), { params: Promise.resolve({ batchId: terfinBatchId }) });
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-disposition")).toContain("rejected.csv");
      const { auditLog } = await import("@/lib/db/schema");
      const audits = await t.ctx.db.select().from(auditLog);
      expect(audits.some((a) => a.action === "DOWNLOAD_PII_REPORT" && a.actor === "user:sub0235")).toBe(true);
      expect((await getReport(new Request(`${BASE}/batches/${terfinBatchId}/reports/..%2Fetc`, { headers: ADMIN }), params({ batchId: terfinBatchId, name: "../etc" }))).status).toBe(400);
      expect((await getReport(new Request(`${BASE}/batches/${headerRejectedId}/reports/rejected.csv`, { headers: ADMIN }), params({ batchId: headerRejectedId, name: "rejected.csv" }))).status).toBe(404);
    });
  });
});

describe("ledger routes", () => {
  it("head is public; entries need Reviewer/Admin; verify needs Admin and is itself ledgered", async () => {
    const head = await (await ledgerHead(new Request(`${BASE}/ledger/head`), params({}))).json();
    expect(head.seq).toBeGreaterThan(5);
    expect((await ledgerEntries(new Request(`${BASE}/ledger/entries`, { headers: SUB_0235 }), params({}))).status).toBe(403);
    const list = await (await ledgerEntries(new Request(`${BASE}/ledger/entries?eventType=BatchReceived&order=asc&limit=2`, { headers: REVIEWER }), params({}))).json();
    expect(list.items).toHaveLength(2);
    expect(list.items[0].seq).toBe(1);
    const one = await (await ledgerEntry(new Request(`${BASE}/ledger/entries/1`, { headers: REVIEWER }), params({ seq: "1" }))).json();
    expect(one.recomputed.matches).toBe(true);
    expect((await ledgerEntry(new Request(`${BASE}/ledger/entries/999999`, { headers: REVIEWER }), params({ seq: "999999" }))).status).toBe(404);

    expect((await post("/ledger/verify", REVIEWER, "{}")).status).toBe(403);
    const v = await post("/ledger/verify", ADMIN, "{}");
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ ok: true, headSeq: head.seq, checked: head.seq });
    expect(v.body.ledgerSeq).toBe(head.seq + 1);
    const after = await (await ledgerHead(new Request(`${BASE}/ledger/head`), params({}))).json();
    expect(after.seq).toBe(head.seq + 1);
    expect((await post("/ledger/verify", ADMIN, "{bad json")).status).toBe(400);
    expect((await post("/ledger/verify", ADMIN, JSON.stringify({ fromSeq: 0 }))).status).toBe(400);
  });
  it("GET /api/rules lists the catalogue", async () => {
    const body = await (await rules(new Request(`${BASE}/rules`), params({}))).json();
    expect(body.items.map((r: { id: string }) => r.id)).toContain("I51");
    expect(body.items.find((r: { id: string }) => r.id === "I7").messageId).toBe("multiple");
  });
});
