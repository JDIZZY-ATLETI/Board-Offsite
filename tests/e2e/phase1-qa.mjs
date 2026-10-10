/**
 * QA Phase-1 browser E2E (plan item 7) against a running `npm run dev` on BASE_URL.
 * Extends scripts/e2e-phase1.mjs with: section 9.5 data-testid presence, DataTable keyboard map (8.2),
 * aria-live announcements, focus visibility, 404/403 boundaries, polling stops on terminal status,
 * D9 confirm dialog, D12 mobile read-only, XSS-as-text, and an axe-core scan per page.
 *   npm run e2e:qa      (writes docs/qa/e2e-qa-results.json + docs/qa/axe-summary.json)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/qa");
mkdirSync(OUT, { recursive: true });
const golden = (s) => readFileSync(path.resolve("tests/golden", s, "input.csv"));
const results = [];
const axeSummary = {};
let failed = 0;
let saltCounter = Date.now() % 100000;
// One extra TERFIN row with a SIN unknown to Ariel: bytes differ per run (dedup key); the only effect on counts is
// exactly +1 rejected row via B2 (QA GAP-E2E-2 - appending bytes mutated the last row).
const SALT_ROWS = 1;
const salted = (buf) => {
  const text = buf.toString("latin1").replace(/(\r?\n)*$/, "");
  const sin = String(100000000 + ((Date.now() + saltCounter++) % 899999999)).slice(0, 9);
  return Buffer.from(`${text}\r\n${sin},SALT,Row,TERFIN,09302026,10.00,980.00,,,1800,,,,,\r\n`, "latin1");
};
const expectedCounts = (s) => JSON.parse(readFileSync(path.resolve("tests/golden", s, "expected-counts.json"), "utf8"));

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  if (!cond) failed += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}
/** Known spec deviation: reported in docs/qa/phase1-report.md, does not fail the run; flips to PASS when fixed. */
function gap(name, cond, detail = "") {
  results.push({ name, pass: cond ? true : "gap", detail });
  console.log(`${cond ? "PASS" : "GAP "}  ${name}${detail ? ` - ${detail}` : ""}`);
}
function note(name, detail) {
  results.push({ name, pass: null, detail });
  console.log(`NOTE  ${name} - ${detail}`);
}

async function login(page, personaId) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`persona-${personaId}`).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByTestId("app-shell").waitFor();
}

async function uploadAndWait(page, buf, name, { employer = null, force = false } = {}) {
  await page.goto(`${BASE}/upload`);
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: buf });
  await page.locator('[data-testid^="preflight-"]').first().waitFor();
  if (employer) await page.locator("#employer").fill(employer);
  if (force) await page.locator("#force-header").click();
  await page.locator("text=computing").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.getByTestId("upload-submit").click();
  await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url();
}

async function axeScan(page, label) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of r) byImpact[v.impact ?? "minor"] += 1;
  axeSummary[label] = { byImpact, violations: r };
  console.log(`AXE   ${label}: critical=${byImpact.critical} serious=${byImpact.serious} moderate=${byImpact.moderate} minor=${byImpact.minor}${r.length ? " -> " + r.map((v) => `${v.id}(${v.impact},${v.nodes})`).join(", ") : ""}`);
  return byImpact;
}

async function testidsPresent(page, ids) {
  const missing = [];
  for (const id of ids) if ((await page.locator(`[data-testid="${id}"], [data-testid^="${id}"]`).count()) === 0) missing.push(id);
  return missing;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("dialog", async (d) => { results.push({ name: "unexpected browser dialog", pass: false, detail: d.message() }); failed += 1; await d.dismiss(); });

try {
  // ---------- Submitter: upload mixed-100-rows, observe polling + live region ----------
  await login(page, "submitter-0235");
  ok("shell testids on dashboard", (await testidsPresent(page, ["app-shell", "page-header", "role-chip", "kpi-batches-today"])).length === 0);
  ok("one <h1> on dashboard", (await page.locator("h1").count()) === 1);
  ok("landmarks: header/nav[aria-label]/main#main/footer", (await page.locator("main#main").count()) === 1 && (await page.locator("nav[aria-label]").count()) >= 1 && (await page.locator("footer").count()) === 1);
  await page.keyboard.press("Tab");
  const skip = await page.evaluate(() => { const a = document.activeElement; const r = a?.getBoundingClientRect(); return { text: a?.textContent?.trim(), visible: !!r && r.width > 0 && r.height > 0, outline: a ? getComputedStyle(a).outlineStyle : null, shadow: a ? getComputedStyle(a).boxShadow : null }; });
  ok("skip link is first in tab order and becomes visible on focus", skip.text === "Skip to main content" && skip.visible, JSON.stringify(skip));
  await page.keyboard.press("Tab");
  const focusRing = await page.evaluate(() => { const a = document.activeElement; const cs = a ? getComputedStyle(a) : null; return cs ? { tag: a.tagName, outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow } : null; });
  ok("focus visible on next focusable (outline or box-shadow)", focusRing && ((focusRing.outline !== "none" && focusRing.outlineWidth !== "0px") || (focusRing.shadow && focusRing.shadow !== "none")), JSON.stringify(focusRing));
  await axeScan(page, "dashboard (Submitter)");

  await page.goto(`${BASE}/upload`);
  ok("upload testids", (await testidsPresent(page, ["dropzone", "upload-submit"])).length === 0);
  await axeScan(page, "upload");

  const apiHits = [];
  page.on("request", (req) => { if (/\/api\/batches\/[0-9a-f-]{36}$/.test(req.url())) apiHits.push(Date.now()); });
  const mixedUrl = await uploadAndWait(page, salted(golden("mixed-100-rows")), `qa-mixed-${Date.now()}.csv`);
  const mixedId = mixedUrl.split("/").pop();
  const initialBadge = await page.locator('[data-testid^="status-badge-"]').first().getAttribute("data-testid");
  await page.getByTestId("status-badge-VALIDATED").first().waitFor({ timeout: 90_000 });
  ok("mixed-100-rows reaches VALIDATED", true, mixedId);
  const mixedApi = await (await page.request.get(`${BASE}/api/batches/${mixedId}`)).json();
  // Execution date = today (golden pins 2026-10-08): date-sensitive rules may move a row between accepted/rejected.
  ok(`GAP-E2E-2: API counts - rows = golden + ${SALT_ROWS} salt row, held = golden, outcomes sum to rows`, mixedApi.counts?.rows === expectedCounts("mixed-100-rows").rows + SALT_ROWS && mixedApi.counts?.held === expectedCounts("mixed-100-rows").held && mixedApi.counts.accepted + mixedApi.counts.rejected + mixedApi.counts.held === mixedApi.counts.rows, JSON.stringify(mixedApi.counts));
  const saltFindings = (await (await page.request.get(`${BASE}/api/batches/${mixedId}/findings?lineNumber=${expectedCounts("mixed-100-rows").rows + 1 + SALT_ROWS}&limit=10`)).json()).items;
  ok("salt row rejected by B2 only", saltFindings.length === 1 && saltFindings[0].ruleId === "B2", saltFindings.map((f) => f.ruleId).join(","));
  ok("preflight testid present on upload (section 9.5)", true);
  const live = await page.getByTestId("batch-live-region").textContent().catch(() => null);
  if (initialBadge === "status-badge-VALIDATED") note("aria-live announcement", "batch was already VALIDATED on first paint; announcement not observable in this run");
  else ok("aria-live region announces the status change", (live ?? "").includes("Batch is now"), `initial=${initialBadge} live=${JSON.stringify(live)}`);
  ok("live region is aria-live=polite + aria-atomic", (await page.getByTestId("batch-live-region").getAttribute("aria-live")) === "polite" && (await page.getByTestId("batch-live-region").getAttribute("aria-atomic")) === "true");
  const hitsAtValidated = apiHits.length;
  await page.waitForTimeout(7_500);
  ok("polling stops on terminal status (no GET /api/batches/{id} for 7.5 s after VALIDATED)", apiHits.length === hitsAtValidated, `polls before=${hitsAtValidated} after=${apiHits.length}`);
  ok("auto-refresh indicator gone after VALIDATED", (await page.locator("text=auto-refresh").count()) === 0);
  ok("batch overview testids", (await testidsPresent(page, ["stepper", "stepper-step-VALIDATED", "next-step", "status-badge-VALIDATED"])).length === 0);
  ok("stepper: Parsed done, Validated current", (await page.getByTestId("stepper-step-PARSED").getAttribute("data-state")) === "done" && (await page.getByTestId("stepper-step-VALIDATED").getAttribute("data-state")) === "current");
  await axeScan(page, "batch overview");

  // ---------- Findings: testids, keyboard map, D9 dialog ----------
  await page.goto(`${mixedUrl}/findings?group=severity`);
  await page.getByTestId("findings-table").waitFor();
  ok("findings testids (findings-table, severity-badge-*, finding/facets, download-rejected-button)", (await testidsPresent(page, ["findings-table", "severity-badge-", "facet-severity", "facet-rule", "download-rejected-button"])).length === 0);
  const rowsLoc = page.locator('[data-testid="findings-table"] tbody tr[data-row-id]');
  const nRows = await rowsLoc.count();
  ok("findings table renders rows", nRows > 5, `${nRows} rows`);
  await rowsLoc.first().focus();
  const r0 = await page.evaluate(() => document.activeElement?.getAttribute("data-row-id"));
  await page.keyboard.press("ArrowDown");
  const r1 = await page.evaluate(() => document.activeElement?.getAttribute("data-row-id"));
  await page.keyboard.press("End");
  const rEnd = await page.evaluate(() => document.activeElement?.getAttribute("data-row-id"));
  await page.keyboard.press("Home");
  const rHome = await page.evaluate(() => document.activeElement?.getAttribute("data-row-id"));
  ok("DataTable keyboard: ArrowDown moves focus to the next row", r0 && r1 && r0 !== r1, `${r0} -> ${r1}`);
  ok("DataTable keyboard: End/Home jump to last/first row", rEnd !== r1 && rHome === r0, `end=${rEnd} home=${rHome}`);
  const rovingOk = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="findings-table"] tbody tr[data-row-id]')]; return rows.filter((r) => r.getAttribute("tabindex") === "0").length === 1 && rows.every((r) => ["0", "-1"].includes(r.getAttribute("tabindex") ?? "")); });
  ok("DataTable uses a roving tabindex (exactly one row tabbable)", rovingOk);
  ok("sortable headers expose aria-sort", (await page.locator('[data-testid="findings-table"] th[aria-sort]').count()) > 0);
  ok("table has a caption and a labelled scroll region", (await page.locator('[data-testid="findings-table"] caption').count()) >= 1 && (await page.locator('[data-testid="findings-table"] [role="region"][aria-label][tabindex="0"]').count()) >= 1);
  await page.getByTestId("download-rejected-button").first().click();
  await page.getByTestId("rejected-csv-dialog").waitFor();
  const dlg = page.getByTestId("rejected-csv-dialog");
  ok("D9: rejected CSV requires a confirm dialog mentioning full SINs", (await dlg.textContent())?.includes("full SINs"));
  const focusInDialog = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="rejected-csv-dialog"]'));
  ok("D9 dialog traps focus (active element inside dialog)", focusInDialog);
  await axeScan(page, "findings (dialog open)");
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
  const focusBack = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  ok("BUG-UI-3 (fixed): Esc closes the dialog and returns focus to the trigger (8.1)", focusBack === "download-rejected-button", `active=${focusBack ?? (await page.evaluate(() => document.activeElement?.tagName))}`);
  await axeScan(page, "findings");
  await page.goto(`${mixedUrl}/findings`);
  await page.getByTestId("findings-table").waitFor();
  await axeScan(page, "findings (grouped by row, Submitter default)");

  // ---------- Records ----------
  await page.goto(`${mixedUrl}/records`);
  await page.getByTestId("records-table").waitFor();
  ok("records testids (records-table, masked-sin, outcome-badge-*)", (await testidsPresent(page, ["records-table", "masked-sin", "outcome-badge-"])).length === 0);
  ok("records never shows 9 contiguous digits", !/\d{9}/.test(await page.getByTestId("records-table").innerText()));
  await axeScan(page, "records");

  // ---------- Reports ----------
  await page.goto(`${mixedUrl}/reports`);
  await page.getByTestId("report-card-execution").waitFor();
  await axeScan(page, "reports");
  await page.getByTestId("report-card-execution").getByRole("link", { name: /View/ }).click();
  await page.waitForURL(/reports\/execution-report/);
  await axeScan(page, "execution report view");

  // ---------- Batches list ----------
  await page.goto(`${BASE}/batches`);
  await page.getByTestId("batches-table").waitFor();
  ok("batches list testids", (await testidsPresent(page, ["batches-table", "status-badge-", "facet-status"])).length === 0);
  await axeScan(page, "batches list");

  // ---------- XSS / formula text rendering ----------
  const H = readFileSync(path.resolve("tests/golden/happy-terfin/input.csv"), "latin1").split("\r\n")[0];
  const xssRow = [`9${String(Date.now()).slice(-8)}`, `"<img src=x onerror=alert(1)>"`, `"=HYPERLINK(""http://evil"",""x"")"`, "TERFIN", "09302026", "-1", "1950.25", "", "", "8450", "", "", "", "", ""].join(",");
  const xssUrl = await uploadAndWait(page, Buffer.from(`${H}\r\n${xssRow}\r\n`, "latin1"), `qa-xss-${Date.now()}.csv`);
  await page.getByTestId("status-badge-VALIDATED").first().waitFor({ timeout: 60_000 });
  await page.goto(`${xssUrl}/records`);
  await page.getByTestId("records-table").waitFor();
  await page.getByRole("button", { name: "Expand row" }).first().click();
  await page.getByRole("region", { name: "Row details" }).waitFor();
  const injected = await page.locator('main img').count();
  const asText = (await page.getByRole("region", { name: "Row details" }).innerText()).includes("<img src=x onerror=alert(1)>");
  ok("HTML in a name cell renders as text (no element injected, no dialog)", injected === 0 && asText, `img=${injected} text=${asText}`);
  await page.goto(`${xssUrl}/findings`);
  await page.getByTestId("findings-table").waitFor();
  ok("formula payload rendered as inert text in findings", (await page.locator('[data-testid="findings-table"] a[href*="evil"]').count()) === 0);

  // ---------- Error boundaries ----------
  const nf = await page.goto(`${BASE}/batches/00000000-0000-7000-8000-00000000beef`, { waitUntil: "networkidle" });
  const nfText = (await page.textContent("main")) ?? "";
  ok("unknown batch -> not-found boundary renders", /couldn't find/i.test(nfText), nfText.replace(/\s+/g, " ").slice(0, 80));
  ok("BUG-UI-2a (fixed): unknown batch answers HTTP 404", nf?.status() === 404, `status=${nf?.status()}`);
  ok("BUG-UI-2b (fixed): batch-scoped not-found copy is used", /find that batch/i.test(nfText));
  const nf2 = await page.goto(`${BASE}/this-route-does-not-exist`);
  ok("unknown route -> 404 page", nf2?.status() === 404, `status=${nf2?.status()}`);
  const badId = await page.goto(`${BASE}/batches/not-a-uuid`, { waitUntil: "networkidle" });
  ok("malformed batch id -> not-found boundary with HTTP 404 (not an unhandled error page)", badId?.status() === 404 && /find that batch/i.test((await page.textContent("main")) ?? "") && !/Application error|unhandled/i.test(await page.textContent("body")), `status=${badId?.status()}`);
  await axeScan(page, "404 page");
  await page.goto(`${BASE}/ledger`);
  await page.waitForURL(/\/forbidden/);
  ok("Submitter /ledger -> /forbidden page", /access/i.test((await page.textContent("h1")) ?? ""));
  await axeScan(page, "403 page");

  // ---------- D12: mobile viewport read-only ----------
  const mobile = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const mp = await mobile.newPage();
  await mp.goto(`${BASE}/login`);
  await mp.getByTestId("persona-submitter-0235").click();
  await mp.waitForURL(`${BASE}/`);
  await mp.goto(`${BASE}/upload`);
  await mp.getByTestId("app-shell").waitFor();
  await mp.waitForLoadState("networkidle");
  // FLAKY-E2E-1: `useIsDesktop` resolves after hydration (matchMedia); wait for the note or the disabled dropzone.
  await mp.locator('text=/desktop browser|1024/i, [data-testid="dropzone"][aria-disabled="true"]').first().waitFor({ timeout: 15_000 }).catch(() => {});
  const mobileNote = (await mp.locator("text=/desktop browser|1024/i").count()) > 0;
  const dzCount = await mp.getByTestId("dropzone").count();
  const dzDisabled = dzCount > 0 ? (await mp.getByTestId("dropzone").getAttribute("aria-disabled")) === "true" : false;
  const submitDisabled = (await mp.getByTestId("upload-submit").count()) > 0 ? await mp.getByTestId("upload-submit").isDisabled() : false;
  ok("D12 (fixed): at 768px Upload is disabled with a desktop-only note", mobileNote && (dzDisabled || submitDisabled), `note=${mobileNote} dropzones=${dzCount} dropzoneDisabled=${dzDisabled} submitDisabled=${submitDisabled}`);
  ok("mobile: no horizontal overflow on batches list", await (async () => { await mp.goto(`${BASE}/batches`); await mp.getByTestId("app-shell").waitFor(); return mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); })());
  await mobile.close();

  // ---------- Admin: ledger explorer, verify, entry drawer, Reviewer disabled ----------
  await login(page, "admin");
  await page.goto(`${BASE}/ledger`);
  await page.getByTestId("ledger-table").waitFor();
  const ledgerMissing = await testidsPresent(page, ["ledger-table", "ledger-head", "verify-button", "integrity-banner-"]);
  ok("ledger testids (ledger-table, ledger-head, verify-button, integrity-banner-*)", ledgerMissing.length === 0, ledgerMissing.join(","));
  ok("COS-1 (fixed): section 9.5 testid ledger-row-{seq} present", (await page.locator('[data-testid^="ledger-row-"]').count()) > 0);
  await axeScan(page, "ledger explorer");
  // The shell banner and the ledger page both render a verify button; use the one inside <main>.
  await page.locator("#main").getByTestId("verify-button").click();
  await page.getByTestId("verify-dialog").waitFor();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByTestId("integrity-banner-verified").waitFor({ timeout: 60_000 });
  ok("Verify returns OK; banner verified", (await page.getByTestId("integrity-banner-verified").textContent())?.includes("Chain verified"));
  const liveOrStatus = await page.evaluate(() => document.querySelectorAll('[aria-live], [role="status"], [role="alert"]').length);
  ok("ledger page exposes a live region / status role for verify progress (8.1)", liveOrStatus > 0, `${liveOrStatus} live/status/alert nodes`);
  await page.locator('[data-testid="ledger-table"] tbody tr[data-row-id]').first().focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("entry-drawer").waitFor({ timeout: 15_000 });
  ok("DataTable keyboard: Enter on a ledger row opens the entry drawer", true);
  await page.getByTestId("entry-drawer").getByText(/Recomputed on open/).waitFor({ timeout: 15_000 });
  ok("entry drawer recomputes hashes on open", (await page.getByTestId("entry-drawer").textContent())?.includes("payloadHash \u2713"));
  await axeScan(page, "ledger explorer (drawer open)");
  await page.keyboard.press("Escape");
  await page.getByTestId("entry-drawer").waitFor({ state: "detached" });
  ok("Esc closes the drawer", true);
  await login(page, "reviewer");
  await page.goto(`${BASE}/ledger`);
  ok("Reviewer sees Verify disabled", await page.locator("#main").getByTestId("verify-button").isDisabled());
  // Phase 2 (BUG-UI-P2-1 fixed): HELD rows drive the "Next step" copy on the batch overview.
  await page.goto(mixedUrl);
  await page.getByTestId("next-step").waitFor();
  const nextStep = (await page.getByTestId("next-step").textContent()) ?? "";
  ok("Phase 2: Reviewer overview of a batch with HELD rows says N held rows need an override (not Ledgering)", /\d+ held rows? need an override/.test(nextStep) && !nextStep.includes("Ledgering"), nextStep.replace(/\s+/g, " ").slice(0, 120));
  ok("Phase 2: Open held rows CTA links to the warnings filter", (await page.getByRole("link", { name: /Open held rows/ }).first().getAttribute("href"))?.includes("severity=WARNING") === true);
  await page.goto(`${BASE}/upload`);
  await page.waitForURL(/\/forbidden/);
  ok("Reviewer /upload -> /forbidden (server-enforced)", true);
  await login(page, "admin");
  await page.goto(`${BASE}/login`);
  await axeScan(page, "login");

  ok("no uncaught page errors during the run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  // ux-design 8.1 gate: zero serious/critical axe violations across every scanned page state.
  const axeBlocking = Object.entries(axeSummary).flatMap(([label, s]) => s.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id}(${v.impact},${v.nodes})`));
  ok("axe: zero serious/critical violations across all page states (ux 8.1)", axeBlocking.length === 0, axeBlocking.slice(0, 8).join("; "));
} catch (err) {
  failed += 1;
  results.push({ name: "ERROR", pass: false, detail: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  console.log(`ERROR ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  await page.screenshot({ path: path.join(OUT, "e2e-qa-failure.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  writeFileSync(path.join(OUT, "e2e-qa-results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), failed, results }, null, 2));
  writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify(axeSummary, null, 2));
  const totals = Object.values(axeSummary).reduce((a, s) => { for (const k of Object.keys(a)) a[k] += s.byImpact[k]; return a; }, { critical: 0, serious: 0, moderate: 0, minor: 0 });
  console.log(`\nAXE totals across ${Object.keys(axeSummary).length} pages: ${JSON.stringify(totals)}`);
  console.log(`\n${results.filter((r) => r.pass === true).length} passed, ${results.filter((r) => r.pass === false).length} failed, ${results.filter((r) => r.pass === "gap").length} known gaps, ${results.filter((r) => r.pass === null).length} notes`);
  process.exit(failed ? 1 : 0);
}
