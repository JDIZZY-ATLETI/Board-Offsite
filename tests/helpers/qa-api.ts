import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { GET as listBatchesRoute, POST as uploadRoute } from "@/app/api/batches/route";
import { GET as getBatchRoute } from "@/app/api/batches/[batchId]/route";
import { GET as getFindingsRoute } from "@/app/api/batches/[batchId]/findings/route";
import { GET as getRecordsRoute } from "@/app/api/batches/[batchId]/records/route";
import { GET as getReportRoute } from "@/app/api/batches/[batchId]/reports/[name]/route";
import { GET as getRejectedCsvRoute } from "@/app/api/batches/[batchId]/rejected.csv/route";
import { GET as ledgerHeadRoute } from "@/app/api/ledger/head/route";
import { GET as ledgerEntriesRoute } from "@/app/api/ledger/entries/route";
import { GET as ledgerEntryRoute } from "@/app/api/ledger/entries/[seq]/route";
import { POST as ledgerVerifyRoute } from "@/app/api/ledger/verify/route";
import { GET as rulesRoute } from "@/app/api/rules/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { DELETE as devLogoutRoute, POST as devLoginRoute } from "@/app/api/auth/dev-login/route";
import { batches, batchStatusHistory, eventsRecords } from "@/lib/db/schema";
import { TRANSITIONS } from "@/lib/pipeline/state-machine";
import { BATCH_STATUSES, EVENTS_CSV_COLUMNS, type BatchStatus } from "@/types";
import type { TestContext } from "./test-context";

export const BASE = "http://localhost/api";
export const ADMIN = { "x-user-id": "qa-admin", "x-user-role": "Admin" };
export const REVIEWER = { "x-user-id": "qa-rev", "x-user-role": "Reviewer" };
export const SUB_0235 = { "x-user-id": "qa-sub0235", "x-user-role": "EmployerSubmitter", "x-employer-id": "0235" };
export const SUB_0359 = { "x-user-id": "qa-sub0359", "x-user-role": "EmployerSubmitter", "x-employer-id": "0359" };
export const NOAUTH: Record<string, string> = {};

export const HEADER = EVENTS_CSV_COLUMNS.join(",");
export type Row = Partial<Record<(typeof EVENTS_CSV_COLUMNS)[number], string>>;

export function validRow(i: number, over: Row = {}): Row {
  const sin = String(900000000 + i).padStart(9, "0");
  return {
    SIN: sin, LastName: `LAST${i}`, FirstName: `First${i}`, EventType: "TERFIN", EmploymentEndDate: "09302026",
    Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: "1950.25", HighContributions_CurrentYear: "320.50", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: "8450",
    Weeks_PreviousYear: "52.00", LowContributions_PreviousYear: "2700.00", HighContributions_PreviousYear: "410.00", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "12100",
    ...over,
  };
}

/** RFC 4180 quoting for cells containing commas, quotes or line breaks. */
export function q(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
export function csvText(rows: Row[], header = HEADER, eol = "\r\n"): string {
  return [header, ...rows.map((r) => EVENTS_CSV_COLUMNS.map((c) => q(r[c] ?? "")).join(","))].join(eol) + eol;
}
export function csvBytes(rows: Row[], header = HEADER, eol = "\r\n"): Buffer {
  return Buffer.from(csvText(rows, header, eol), "latin1");
}
export function manyRows(n: number, salt = 0): Row[] {
  return Array.from({ length: n }, (_, i) => validRow(i + 1 + salt));
}

export const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

export function form(bytes: Buffer, fields: Record<string, string>, filename = "events.csv", type = "text/csv"): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], filename, { type }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export interface ApiResult { status: number; body: any; headers: Headers; text: string }

async function toResult(input: Response | Promise<Response>): Promise<ApiResult> {
  const res = await input;
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, body, headers: res.headers, text };
}

export async function upload(bytes: Buffer, headers: Record<string, string>, fields: Record<string, string>, opts: { filename?: string; type?: string; wait?: boolean } = {}): Promise<ApiResult> {
  const q = opts.wait === false ? "" : "?wait=true";
  const res = await uploadRoute(new Request(`${BASE}/batches${q}`, { method: "POST", headers, body: form(bytes, fields, opts.filename ?? "events.csv", opts.type ?? "text/csv") }), params({}));
  return toResult(res);
}

export async function uploadRaw(headers: Record<string, string>, body: BodyInit | null, contentType?: string): Promise<ApiResult> {
  const h: Record<string, string> = { ...headers };
  if (contentType) h["content-type"] = contentType;
  return toResult(await uploadRoute(new Request(`${BASE}/batches?wait=true`, { method: "POST", headers: h, body }), params({})));
}

export const api = {
  health: (h: Record<string, string> = {}) => toResult(healthRoute(new Request(`${BASE}/health`, { headers: h }), params({})) as unknown as Promise<Response>),
  listBatches: (h: Record<string, string>, qs = "") => toResult(listBatchesRoute(new Request(`${BASE}/batches${qs}`, { headers: h }), params({})) as unknown as Promise<Response>),
  getBatch: (h: Record<string, string>, id: string) => toResult(getBatchRoute(new Request(`${BASE}/batches/${id}`, { headers: h }), params({ batchId: id })) as unknown as Promise<Response>),
  findings: (h: Record<string, string>, id: string, qs = "") => toResult(getFindingsRoute(new Request(`${BASE}/batches/${id}/findings${qs}`, { headers: h }), params({ batchId: id })) as unknown as Promise<Response>),
  records: (h: Record<string, string>, id: string, qs = "") => toResult(getRecordsRoute(new Request(`${BASE}/batches/${id}/records${qs}`, { headers: h }), params({ batchId: id })) as unknown as Promise<Response>),
  report: (h: Record<string, string>, id: string, name: string) => toResult(getReportRoute(new Request(`${BASE}/batches/${id}/reports/${encodeURIComponent(name)}`, { headers: h }), params({ batchId: id, name })) as unknown as Promise<Response>),
  rejectedCsv: (h: Record<string, string>, id: string) => toResult(getRejectedCsvRoute(new Request(`${BASE}/batches/${id}/rejected.csv`, { headers: h }), { params: Promise.resolve({ batchId: id }) })),
  ledgerHead: (h: Record<string, string> = {}) => toResult(ledgerHeadRoute(new Request(`${BASE}/ledger/head`, { headers: h }), params({})) as unknown as Promise<Response>),
  ledgerEntries: (h: Record<string, string>, qs = "") => toResult(ledgerEntriesRoute(new Request(`${BASE}/ledger/entries${qs}`, { headers: h }), params({})) as unknown as Promise<Response>),
  ledgerEntry: (h: Record<string, string>, seq: string) => toResult(ledgerEntryRoute(new Request(`${BASE}/ledger/entries/${seq}`, { headers: h }), params({ seq })) as unknown as Promise<Response>),
  verify: (h: Record<string, string>, body: string) => toResult(ledgerVerifyRoute(new Request(`${BASE}/ledger/verify`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body }), params({})) as unknown as Promise<Response>),
  rules: (h: Record<string, string> = {}) => toResult(rulesRoute(new Request(`${BASE}/rules`, { headers: h }), params({})) as unknown as Promise<Response>),
  devLogin: (body: string, h: Record<string, string> = {}) => toResult(devLoginRoute(new Request(`${BASE}/auth/dev-login`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body }), params({})) as unknown as Promise<Response>),
  devLogout: () => toResult(devLogoutRoute(new Request(`${BASE}/auth/dev-login`, { method: "DELETE" }), params({})) as unknown as Promise<Response>),
};

/** Error responses must be the architecture section 11 envelope and must never leak stack traces. */
export function expectErrorEnvelope(r: ApiResult, status?: number, code?: string): void {
  if (status !== undefined) expect(r.status, r.text).toBe(status);
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(r.body, r.text).toBeTruthy();
  expect(typeof r.body.error?.code).toBe("string");
  expect(typeof r.body.error?.message).toBe("string");
  if (code) expect(r.body.error.code).toBe(code);
  expect(r.text).not.toMatch(/\n\s+at |stack|node_modules|\.ts:\d+/);
  expect(r.headers.get("x-correlation-id")).toBeTruthy();
}

function isPath(history: Array<string | null>): boolean {
  if (history[0] !== null || history[1] !== "RECEIVED") return false;
  for (let i = 1; i < history.length - 1; i++) {
    const from = history[i] as BatchStatus;
    const to = history[i + 1] as BatchStatus;
    if (!TRANSITIONS[from].includes(to)) return false;
  }
  return true;
}

/** The batch must be in a legal section 10.1 state reached through legal transitions; FILE_REJECTED has no records. */
export async function expectLegalBatchState(t: TestContext, batchId: string): Promise<{ status: BatchStatus; history: string[] }> {
  const [b] = await t.ctx.db.select().from(batches).where(eq(batches.batchId, batchId));
  expect(b, `batch ${batchId} exists`).toBeTruthy();
  expect(BATCH_STATUSES).toContain(b.status);
  const hist = await t.ctx.db.select().from(batchStatusHistory).where(eq(batchStatusHistory.batchId, batchId)).orderBy(batchStatusHistory.at, batchStatusHistory.id);
  const chain: Array<string | null> = [hist[0]?.fromStatus ?? null, ...hist.map((h) => h.toStatus)];
  expect(isPath(chain), `status history ${JSON.stringify(chain)} must be a legal path`).toBe(true);
  expect(chain[chain.length - 1]).toBe(b.status);
  expect(["RECEIVED", "PARSED"]).not.toContain(b.status);
  if (b.status === "FILE_REJECTED") {
    expect(await t.ctx.db.select().from(eventsRecords).where(eq(eventsRecords.batchId, batchId))).toHaveLength(0);
  }
  return { status: b.status, history: hist.map((h) => h.toStatus) };
}
