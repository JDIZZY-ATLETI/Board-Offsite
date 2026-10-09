import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { middleware } from "@/middleware";
import { decodeDevSession, DEV_SESSION_COOKIE, encodeDevSession } from "@/lib/auth/dev-session";
import { HeaderAuthProvider } from "@/lib/auth/session";
import { validationFindings } from "@/lib/db/schema";
import { decodeBytes } from "@/lib/events/decode";
import { goldenInput } from "../helpers/fixtures";
import { ADMIN, api, csvBytes, expectErrorEnvelope, NOAUTH, REVIEWER, SUB_0235, SUB_0359, upload, validRow } from "../helpers/qa-api";
import { createTestContext, type TestContext } from "../helpers/test-context";

/** QA plan item 6: role matrix, employer scoping, PRIVATE visibility, dev auth bridge, CSRF, traversal, PII sweep. */

let t: TestContext;
let b0235: string; // mixed-100-rows for employer 0235 (has rejected rows => rejected.csv has raw SINs)
let b0359: string;
const env = process.env as Record<string, string | undefined>;
const origEnv = env.NODE_ENV;

beforeAll(async () => {
  t = await createTestContext();
  b0235 = (await upload(goldenInput("mixed-100-rows"), ADMIN, { employerId: "0235", executionDate: "2026-10-08" }, { filename: "mixed.csv" })).body.batchId;
  b0359 = (await upload(csvBytes([validRow(7001, { Weeks_CurrentYear: "-1" })]), ADMIN, { employerId: "0359", executionDate: "2026-10-08" }, { filename: "other.csv" })).body.batchId;
  // A PRIVATE finding (SYS-RULE-ERROR shape) so visibility filtering can be observed end-to-end.
  await t.ctx.db.insert(validationFindings).values({
    findingId: "00000000-0000-7000-8000-0000000a0001",
    batchId: b0235, recordId: null, lineNumber: 2, sinPseudo: null, ruleId: "SYS-RULE-ERROR", messageId: "SYS-RULE-ERROR", level: "L1", severity: "COMPLETE_MEMBER_ERROR", visibility: "PRIVATE",
    field: null, yearScope: null, params: { rule: "QA", error: "injected" }, dataImportMessage: "Rule QA failed: injected-private-marker", portalMessage: "A validation rule could not be evaluated for this record. HOOPP has been notified.",
    overrideReasons: [], calculated: null, sortOrder: 99, createdAt: new Date().toISOString(),
  });
});
afterAll(() => t.cleanup());
afterEach(() => {
  env.NODE_ENV = origEnv;
});

type H = Record<string, string>;
const ROLES: Array<[string, H]> = [["anon", NOAUTH], ["submitter", SUB_0235], ["reviewer", REVIEWER], ["admin", ADMIN]];

describe("QA/security: role matrix for every Phase-1 route", () => {
  // expected status per role: [anon, submitter(own employer), reviewer, admin]
  const matrix: Array<[string, (h: H) => Promise<{ status: number }>, [number, number, number, number]]> = [
    ["GET /api/health", (h) => api.health(h), [200, 200, 200, 200]],
    ["GET /api/rules", (h) => api.rules(h), [200, 200, 200, 200]],
    ["GET /api/ledger/head", (h) => api.ledgerHead(h), [200, 200, 200, 200]],
    ["GET /api/batches", (h) => api.listBatches(h), [401, 200, 200, 200]],
    ["POST /api/batches", (h) => upload(csvBytes([validRow(7777)]), h, { employerId: "0235" }), [401, 200, 403, 200]],
    ["GET /api/batches/{id}", (h) => api.getBatch(h, b0235), [401, 200, 200, 200]],
    ["GET /api/batches/{id}/findings", (h) => api.findings(h, b0235), [401, 200, 200, 200]],
    ["GET /api/batches/{id}/findings?visibility=PRIVATE", (h) => api.findings(h, b0235, "?visibility=PRIVATE"), [401, 403, 200, 200]],
    ["GET /api/batches/{id}/records", (h) => api.records(h, b0235), [401, 200, 200, 200]],
    ["GET /api/batches/{id}/reports/execution-report.json", (h) => api.report(h, b0235, "execution-report.json"), [401, 200, 200, 200]],
    ["GET /api/batches/{id}/rejected.csv", (h) => api.rejectedCsv(h, b0235), [401, 200, 200, 200]],
    ["GET /api/ledger/entries", (h) => api.ledgerEntries(h), [401, 403, 200, 200]],
    ["GET /api/ledger/entries/1", (h) => api.ledgerEntry(h, "1"), [401, 403, 200, 200]],
    ["POST /api/ledger/verify", (h) => api.verify(h, "{}"), [401, 403, 403, 200]],
  ];
  it.each(matrix)("%s", async (_name, call, expected) => {
    for (let i = 0; i < ROLES.length; i++) {
      const [role, h] = ROLES[i];
      const r = (await call(h)) as { status: number; body?: any; text?: string };
      expect(r.status, `${_name} as ${role}`).toBe(expected[i]);
      if (r.status >= 400 && r.text !== undefined) expectErrorEnvelope(r as never, expected[i], expected[i] === 401 ? undefined : "FORBIDDEN");
    }
  });
  it("401 codes: UNAUTHENTICATED when no identity; INVALID_ROLE / EMPLOYER_REQUIRED / INVALID_USER for malformed identities", async () => {
    expectErrorEnvelope(await api.listBatches({}), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.listBatches({ "x-user-id": "u", "x-user-role": "SuperAdmin" }), 401, "INVALID_ROLE");
    expectErrorEnvelope(await api.listBatches({ "x-user-id": "u", "x-user-role": "admin" }), 401, "INVALID_ROLE");
    expectErrorEnvelope(await api.listBatches({ "x-user-id": "u", "x-user-role": "EmployerSubmitter" }), 401, "EMPLOYER_REQUIRED");
    expectErrorEnvelope(await api.listBatches({ "x-user-id": "u<script>", "x-user-role": "Admin" }), 401, "INVALID_USER");
    expectErrorEnvelope(await api.listBatches({ "x-user-id": "u".repeat(129), "x-user-role": "Admin" }), 401, "INVALID_USER");
    expectErrorEnvelope(await api.listBatches({ "x-user-id": "u" }), 401, "UNAUTHENTICATED");
    expectErrorEnvelope(await api.listBatches({ "x-user-role": "Admin" }), 401, "UNAUTHENTICATED");
    expect((await api.listBatches({ "x-user-id": "u", "x-role": "Admin" })).status).toBe(200);
  });
});

describe("QA/security: employer scoping for Submitters", () => {
  it("another employer's batch is invisible (404, not 403) on every batch-scoped route", async () => {
    for (const [name, r] of [
      ["batch", await api.getBatch(SUB_0359, b0235)],
      ["findings", await api.findings(SUB_0359, b0235)],
      ["records", await api.records(SUB_0359, b0235)],
      ["report", await api.report(SUB_0359, b0235, "execution-report.json")],
      ["manifest", await api.report(SUB_0359, b0235, "manifest.json")],
      ["rejected.csv", await api.rejectedCsv(SUB_0359, b0235)],
    ] as const) {
      expectErrorEnvelope(r, 404, "NOT_FOUND");
      expect(r.text, name).not.toContain("0235");
    }
    expect((await api.getBatch(SUB_0359, b0359)).status).toBe(200);
    expect((await api.rejectedCsv(SUB_0359, b0359)).status).toBe(200);
  });
  it("list never leaks other employers even with employerId/status/cursor games", async () => {
    for (const qs of ["", "?employerId=0235", "?employerId=0235&status=VALIDATED", `?cursor=${b0235}`, "?limit=200"]) {
      const r = await api.listBatches(SUB_0359, qs);
      expect(r.status, qs).toBe(200);
      expect(r.body.items.every((b: { employerId: string }) => b.employerId === "0359"), qs).toBe(true);
    }
  });
  it("ID enumeration: non-UUID ids are 400, unknown UUIDs are 404, both without leaking", async () => {
    expectErrorEnvelope(await api.getBatch(ADMIN, "1"), 400);
    expectErrorEnvelope(await api.getBatch(ADMIN, "00000000-0000-7000-8000-00000000beef"), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.findings(SUB_0235, "%27%20OR%201=1--"), 400);
  });
  it("no PII-bearing download for another employer is audit-logged as a success", async () => {
    const { auditLog } = await import("@/lib/db/schema");
    const before = (await t.ctx.db.select().from(auditLog)).length;
    await api.rejectedCsv(SUB_0359, b0235);
    expect((await t.ctx.db.select().from(auditLog)).length).toBe(before);
  });
});

describe("QA/security: PRIVATE findings", () => {
  it("are excluded from Submitter list, pages and facets, but visible to Reviewer/Admin", async () => {
    const all = async (h: H) => {
      const out: any[] = [];
      let cursor: string | null = null;
      do {
        const r = await api.findings(h, b0235, `?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        expect(r.status).toBe(200);
        out.push(...r.body.items);
        cursor = r.body.nextCursor;
      } while (cursor);
      return out;
    };
    const sub = await all(SUB_0235);
    const rev = await all(REVIEWER);
    expect(sub.some((f) => f.visibility === "PRIVATE")).toBe(false);
    expect(JSON.stringify(sub)).not.toContain("injected-private-marker");
    expect(rev.filter((f) => f.visibility === "PRIVATE")).toHaveLength(1);
    expect(rev.length).toBe(sub.length + 1);
    // visibility=PUBLIC is allowed for a Submitter; explicit PRIVATE is 403 (covered in matrix).
    expect((await api.findings(SUB_0235, b0235, "?visibility=PUBLIC")).status).toBe(200);
    // ruleId / lineNumber filters cannot be used to fish for the private row.
    expect((await api.findings(SUB_0235, b0235, "?ruleId=SYS-RULE-ERROR")).body.items).toHaveLength(0);
    expect((await api.findings(REVIEWER, b0235, "?ruleId=SYS-RULE-ERROR")).body.items).toHaveLength(1);
    const { findingFacets } = await import("@/lib/queries/findings");
    expect((await findingFacets(t.ctx, b0235, false)).byRule.some((r) => r.value === "SYS-RULE-ERROR")).toBe(false);
    expect((await findingFacets(t.ctx, b0235, true)).byRule.some((r) => r.value === "SYS-RULE-ERROR")).toBe(true);
  });
});

describe("QA/security: dev session cookie + middleware bridge", () => {
  const cookieFor = (s: Parameters<typeof encodeDevSession>[0]) => `${DEV_SESSION_COOKIE}=${encodeDevSession(s)}`;
  const mw = (init: { method?: string; cookie?: string; headers?: H; path?: string; origin?: string }) => {
    const h = new Headers(init.headers ?? {});
    if (init.cookie) h.set("cookie", init.cookie);
    if (init.origin) h.set("origin", init.origin);
    return middleware(new NextRequest(`http://localhost:3000${init.path ?? "/api/batches"}`, { method: init.method ?? "GET", headers: h }));
  };
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it("decodeDevSession rejects tampered / malformed cookies and round-trips valid ones", () => {
    const ok = { userId: "jsmith", role: "EmployerSubmitter" as const, employerId: "0235" };
    expect(decodeDevSession(encodeDevSession(ok))).toEqual(ok);
    expect(decodeDevSession(undefined)).toBeNull();
    expect(decodeDevSession("")).toBeNull();
    expect(decodeDevSession("not-base64!!")).toBeNull();
    expect(decodeDevSession(Buffer.from("{bad json").toString("base64url"))).toBeNull();
    expect(decodeDevSession(Buffer.from(JSON.stringify({ u: "x", r: "SuperAdmin", e: null })).toString("base64url"))).toBeNull();
    expect(decodeDevSession(Buffer.from(JSON.stringify({ u: "x", r: "EmployerSubmitter", e: null })).toString("base64url"))).toBeNull();
    expect(decodeDevSession(Buffer.from(JSON.stringify({ u: "x<script>", r: "Admin", e: null })).toString("base64url"))).toBeNull();
    expect(decodeDevSession(Buffer.from(JSON.stringify({ u: "x", r: "Admin", e: "../0235" })).toString("base64url"))).toEqual({ userId: "x", role: "Admin", employerId: null });
    expect(decodeDevSession(Buffer.from(JSON.stringify(["x"])).toString("base64url"))).toBeNull();
    expect(decodeDevSession(Buffer.from("null").toString("base64url"))).toBeNull();
  });
  it("copies cookie facts onto x-user-* request headers (non-production)", () => {
    env.NODE_ENV = "test";
    const res = mw({ cookie: cookieFor({ userId: "jsmith", role: "EmployerSubmitter", employerId: "0235" }) });
    expect(res.status).toBe(200);
    expect(forwarded(res, "x-user-id")).toBe("jsmith");
    expect(forwarded(res, "x-user-role")).toBe("EmployerSubmitter");
    expect(forwarded(res, "x-employer-id")).toBe("0235");
    const admin = mw({ cookie: cookieFor({ userId: "admin", role: "Admin", employerId: null }), headers: { "x-employer-id": "0235" } });
    expect(forwarded(admin, "x-employer-id")).toBeNull();
  });
  it("no / invalid cookie -> request passes through untouched (handler returns 401)", () => {
    env.NODE_ENV = "test";
    expect(forwarded(mw({}), "x-user-id")).toBeNull();
    expect(forwarded(mw({ cookie: `${DEV_SESSION_COOKIE}=garbage` }), "x-user-id")).toBeNull();
  });
  it("CSRF: cookie-authenticated non-GET from a foreign Origin is refused with 403; same-origin and GET pass", () => {
    env.NODE_ENV = "test";
    const c = cookieFor({ userId: "admin", role: "Admin", employerId: null });
    const bad = mw({ method: "POST", cookie: c, origin: "https://evil.example", path: "/api/ledger/verify" });
    expect(bad.status).toBe(403);
    expect(mw({ method: "POST", cookie: c, origin: "http://localhost:3000", path: "/api/ledger/verify" }).status).toBe(200);
    expect(mw({ method: "GET", cookie: c, origin: "https://evil.example" }).status).toBe(200);
    expect(mw({ method: "DELETE", cookie: c, origin: "https://evil.example", path: "/api/auth/dev-login" }).status).toBe(403);
  });
  it("GAP-SEC-2: a cookie-authenticated POST with NO Origin header passes the CSRF check (relies on SameSite=Lax)", () => {
    env.NODE_ENV = "test";
    expect(mw({ method: "POST", cookie: cookieFor({ userId: "admin", role: "Admin", employerId: null }), path: "/api/ledger/verify" }).status).toBe(200);
  });
  it("GAP-SEC-3: login CSRF - POST /api/auth/dev-login without a session is never origin-checked by the middleware", () => {
    env.NODE_ENV = "test";
    expect(mw({ method: "POST", origin: "https://evil.example", path: "/api/auth/dev-login" }).status).toBe(200);
  });
  it("an explicit x-user-id header wins over the cookie (documented dev behaviour)", () => {
    env.NODE_ENV = "test";
    const res = mw({ cookie: cookieFor({ userId: "jsmith", role: "EmployerSubmitter", employerId: "0235" }), headers: { "x-user-id": "spoof", "x-user-role": "Admin" } });
    expect(forwarded(res, "x-user-id")).toBeNull();
  });
  it("production: middleware does not bridge cookies", () => {
    env.NODE_ENV = "production";
    const res = mw({ cookie: cookieFor({ userId: "admin", role: "Admin", employerId: null }) });
    expect(forwarded(res, "x-user-id")).toBeNull();
  });
  it.fails("BUG-SEC-1 (Critical): in production the x-user-* headers are still trusted end-to-end; a browser can forge Admin", async () => {
    env.NODE_ENV = "production";
    const res = mw({ headers: { "x-user-id": "attacker", "x-user-role": "Admin" } });
    // Middleware must strip (or the provider must refuse) identity headers that did not come from a trusted source.
    const stripped = res.headers.get("x-middleware-override-headers") !== null && forwarded(res, "x-user-id") === null && !res.headers.get("x-middleware-override-headers")!.includes("x-user-id");
    const session = await new HeaderAuthProvider().getSession(new Request("http://x/", { headers: { "x-user-id": "attacker", "x-user-role": "Admin" } }));
    expect(stripped || session === null).toBe(true);
  });
});

describe("QA/security: dev-login route", () => {
  it("sets an HttpOnly SameSite=Lax session cookie, validates input, is audit-logged, and DELETE clears it", async () => {
    env.NODE_ENV = "test";
    const ok = await api.devLogin(JSON.stringify({ userId: "jsmith", role: "EmployerSubmitter", employerId: "0235" }));
    expect(ok.status).toBe(200);
    const sc = ok.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(new RegExp(`^${DEV_SESSION_COOKIE}=`));
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Path=/");
    expect(decodeDevSession(sc.split(";")[0].split("=")[1])).toEqual({ userId: "jsmith", role: "EmployerSubmitter", employerId: "0235" });
    expectErrorEnvelope(await api.devLogin(JSON.stringify({ userId: "jsmith", role: "EmployerSubmitter" })), 400, "EMPLOYER_REQUIRED");
    expectErrorEnvelope(await api.devLogin(JSON.stringify({ userId: "jsmith", role: "Root" })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.devLogin(JSON.stringify({ userId: "<img onerror=x>", role: "Admin" })), 400, "VALIDATION_ERROR");
    expectErrorEnvelope(await api.devLogin("{nope"), 400, "INVALID_JSON");
    const out = await api.devLogout();
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    const { auditLog } = await import("@/lib/db/schema");
    expect((await t.ctx.db.select().from(auditLog)).some((a) => a.action === "DEV_LOGIN" && a.actor === "user:jsmith")).toBe(true);
  });
  it("is a 404 in production (both POST and DELETE)", async () => {
    env.NODE_ENV = "production";
    expectErrorEnvelope(await api.devLogin(JSON.stringify({ userId: "admin", role: "Admin" })), 404, "NOT_FOUND");
    expectErrorEnvelope(await api.devLogout(), 404, "NOT_FOUND");
  });
});

describe("QA/security: path traversal and input hardening on downloads", () => {
  it("report name is an enum: traversal, encoded traversal and look-alikes are 400; alias route inherits scoping", async () => {
    for (const name of ["../../etc/passwd", "..%2F..%2Fmanifest.json", "execution-report.json/../manifest.json", "manifest.json\u0000.txt", "MANIFEST.JSON", "original.csv", "rejected.csv.bak", ""]) {
      const r = await api.report(ADMIN, b0235, name);
      expect(r.status, JSON.stringify(name)).toBe(name === "" ? 400 : 400);
    }
    expect((await api.report(ADMIN, b0235, "manifest.json")).status).toBe(200);
  });
  it("downloads carry no-store and a safe attachment filename built from the batch id only", async () => {
    const r = await api.rejectedCsv(ADMIN, b0235);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="${b0235}-rejected.csv"`);
  });
});

describe("QA/security: raw-SIN leak sweep (AC6 + section 13.3)", () => {
  /** Every 9-digit SIN present in the mixed-100-rows input (raw cells, before padding). */
  const sins = (): string[] => {
    const text = decodeBytes(goldenInput("mixed-100-rows")).text;
    const out = new Set<string>();
    for (const line of text.split(/\r?\n/).slice(1)) {
      const cell = line.split(",")[0]?.trim();
      if (/^\d{9}$/.test(cell)) out.add(cell);
    }
    return [...out];
  };
  const assertClean = (label: string, text: string, list: string[]) => {
    for (const s of list) expect(text, `${label} leaks SIN ending ${s.slice(-3)}`).not.toContain(s);
  };
  it("no raw SIN in any JSON API response for the batch (batch, findings, records, all pages)", async () => {
    const list = sins();
    expect(list.length).toBeGreaterThan(50);
    assertClean("batch", (await api.getBatch(ADMIN, b0235)).text, list);
    let cursor: string | null = null;
    do {
      const r = await api.findings(ADMIN, b0235, `?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assertClean("findings", r.text, list);
      cursor = r.body.nextCursor;
    } while (cursor);
    cursor = null;
    do {
      const r = await api.records(ADMIN, b0235, `?limit=200${cursor ? `&cursor=${cursor}` : ""}`);
      assertClean("records", r.text, list);
      expect(r.text).not.toMatch(/"sin":/);
      cursor = r.body.nextCursor;
    } while (cursor);
    assertClean("list", (await api.listBatches(ADMIN, "?limit=200")).text, list);
  });
  it("no raw SIN in any report/artifact except rejected.csv, which contains them and is audit-logged", async () => {
    const list = sins();
    for (const name of ["execution-report.json", "execution-report.html", "findings.ndjson", "accepted.ndjson", "records.ndjson", "header.json", "manifest.json"]) {
      const r = await api.report(ADMIN, b0235, name);
      expect(r.status, name).toBe(200);
      assertClean(name, r.text, list);
    }
    const rejected = await api.rejectedCsv(REVIEWER, b0235);
    expect(rejected.status).toBe(200);
    expect(list.some((s) => rejected.text.includes(s))).toBe(true);
    const { auditLog } = await import("@/lib/db/schema");
    expect((await t.ctx.db.select().from(auditLog)).some((a) => a.action === "DOWNLOAD_PII_REPORT" && a.actor === "user:qa-rev" && a.target === `batch:${b0235}/rejected.csv`)).toBe(true);
  });
  it("no raw SIN in any ledger entry (payloads, stream ids) or in the system log stream captured during the run", async () => {
    const list = sins();
    let cursor: string | null = null;
    let n = 0;
    do {
      const r = await api.ledgerEntries(ADMIN, `?limit=200&order=asc${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      assertClean("ledger", r.text, list);
      n += r.body.items.length;
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(n).toBeGreaterThan(40);
    const logs = t.logs.join("\n");
    expect(logs.length).toBeGreaterThan(1000);
    assertClean("logs", logs, list);
    // Also no SIN-shaped 9-digit token anywhere in the logs that is not a known non-SIN number.
    expect(logs.match(/\b9\d{8}\b/g) ?? []).toEqual([]);
  });
  it("no raw SIN on disk outside raw/original.csv and silver/rejected.csv", async () => {
    const list = sins();
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = walk(t.lakeRoot);
    expect(files.length).toBeGreaterThan(8);
    const allowed = /(^|[\\/])(original\.csv|rejected\.csv)$/;
    for (const f of files) {
      if (allowed.test(f)) continue;
      assertClean(path.relative(t.lakeRoot, f), readFileSync(f, "latin1"), list);
    }
  });
  it("the DB holds SIN only as pseudonym, mask and ciphertext", async () => {
    const list = sins();
    const { eventsRecords } = await import("@/lib/db/schema");
    const rows = await t.ctx.db.select().from(eventsRecords);
    expect(rows.length).toBeGreaterThan(90);
    assertClean("events_records", JSON.stringify(rows.map((r) => ({ ...r, sinEnc: undefined }))), list);
    const findings = await t.ctx.db.select().from(validationFindings);
    assertClean("validation_findings", JSON.stringify(findings), list);
  });
});
