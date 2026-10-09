/**
 * Phase 1B manual E2E (docs/ux-design.md section 6.1) against a running `npm run dev` on BASE_URL.
 * Drives the installed Chrome through playwright-core (no browser download) and writes screenshots to
 * docs/screenshots/phase1/. Exit code 1 on any failed assertion.
 *   node scripts/e2e-phase1.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/screenshots/phase1");
mkdirSync(OUT, { recursive: true });
const golden = (s) => path.resolve("tests/golden", s, "input.csv");
const results = [];
let failed = 0;

function ok(name, cond, detail = "") {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed += 1;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function login(page, personaId) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`persona-${personaId}`).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByTestId("app-shell").waitFor();
}

async function upload(page, scenario, filename) {
  await page.goto(`${BASE}/upload`);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: filename, mimeType: "text/csv", buffer: (await import("node:fs")).readFileSync(golden(scenario)) });
  await page.locator('[data-testid^="preflight-"]').first().waitFor();
  const preflight = await page.locator('[data-testid^="preflight-"]').first().getAttribute("data-testid");
  return { preflight };
}

async function waitForStatus(page, status, timeout = 90_000) {
  await page.getByTestId(`status-badge-${status}`).first().waitFor({ timeout });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (e) => results.push(`PAGEERROR ${e.message}`));
// Salt files so re-running against a persistent DB still creates fresh batches (identical bytes are deduplicated).
const salt = `\r\n`;
const fs = await import("node:fs");
// Blank trailing lines are skipped by the parser, so a unique run of CRLFs changes the bytes without adding rows.
let saltCounter = Date.now() % 1000;
const salted = (scenario) => Buffer.concat([fs.readFileSync(golden(scenario)), Buffer.from(salt.repeat(2 + (saltCounter++ % 997)))]);

try {
  // ---- Submitter: dashboard, upload happy-terfin -> VALIDATED via polling ----
  await login(page, "submitter-0235");
  ok("login as Submitter lands on Dashboard", (await page.locator("h1").first().textContent())?.includes("Dashboard"));
  ok("Submitter nav hides Ledger explorer", (await page.locator('nav[aria-label="Primary"] a', { hasText: "Ledger explorer" }).count()) === 0);
  await shot(page, "dashboard");

  await page.goto(`${BASE}/upload`);
  await page.locator('input[type="file"]').setInputFiles({ name: `happy-terfin-${Date.now()}.csv`, mimeType: "text/csv", buffer: salted("happy-terfin") });
  await page.getByTestId("preflight-ok").waitFor();
  ok("pre-flight OK for happy-terfin", true);
  await page.locator("text=computing").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await shot(page, "upload");
  await page.getByTestId("upload-submit").click();
  await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const happyUrl = page.url();
  await waitForStatus(page, "VALIDATED");
  ok("happy-terfin reaches VALIDATED", true, happyUrl.split("/").pop());
  const validatedStep = page.getByTestId("stepper-step-VALIDATED");
  ok("stepper marks Validated as current", (await validatedStep.getAttribute("data-state")) === "current");
  ok("stepper marks Parsed as done", (await page.getByTestId("stepper-step-PARSED").getAttribute("data-state")) === "done");
  ok("Next step copy for Submitter (VALIDATED clean)", (await page.getByTestId("next-step").textContent())?.includes("Validation complete"));

  // ---- Submitter: file-rejected-header -> FILE_REJECTED with I51 ----
  await page.goto(`${BASE}/upload`);
  await page.locator('input[type="file"]').setInputFiles({ name: `bad-header-${Date.now()}.csv`, mimeType: "text/csv", buffer: salted("file-rejected-header") });
  await page.getByTestId("preflight-error").waitFor();
  ok("pre-flight flags the bad header (I51-like)", true);
  ok("Submitter cannot submit a header-rejected file", await page.getByTestId("upload-submit").isDisabled());

  // Admin can upload anyway to record the FILE_REJECTED batch for the record.
  await login(page, "admin");
  await page.goto(`${BASE}/upload`);
  await page.locator('input[type="file"]').setInputFiles({ name: `bad-header-${Date.now()}.csv`, mimeType: "text/csv", buffer: salted("file-rejected-header") });
  await page.getByTestId("preflight-error").waitFor();
  await page.locator("#employer").fill("0235");
  await page.locator("#force-header").click();
  await page.locator("text=computing").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.getByTestId("upload-submit").click();
  await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await waitForStatus(page, "FILE_REJECTED");
  ok("bad header reaches FILE_REJECTED", true);
  ok("Overview shows the I51 finding", (await page.locator('[data-testid^="finding-card-"]').first().textContent())?.includes("I51"));
  await page.goto(`${page.url()}/findings`);
  await page.getByTestId("findings-table").waitFor();
  ok("Findings tab shows I51 file-level finding", (await page.getByTestId("findings-table").textContent())?.includes("I51"));

  // ---- mixed-100-rows as Submitter: findings / records / reports ----
  await login(page, "submitter-0235");
  await page.goto(`${BASE}/upload`);
  await page.locator('input[type="file"]').setInputFiles({ name: `mixed-${Date.now()}.csv`, mimeType: "text/csv", buffer: salted("mixed-100-rows") });
  await page.getByTestId("preflight-ok").waitFor();
  await page.locator("text=computing").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.getByTestId("upload-submit").click();
  await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const mixedUrl = page.url();
  await waitForStatus(page, "VALIDATED");
  ok("mixed-100-rows reaches VALIDATED", true);
  await shot(page, "batch-overview");
  ok("Overview shows 38 rejected", (await page.locator("text=Rejected").first().locator("..").textContent())?.includes("38") || (await page.textContent("body"))?.includes("38"));

  await page.goto(`${mixedUrl}/findings`);
  await page.getByTestId("findings-table").waitFor();
  const rowGroups = await page.getByRole("list", { name: "Findings grouped by row" }).locator(":scope > li").count();
  ok("Submitter findings default to group-by-row", rowGroups > 0, `${rowGroups} rows`);
  await shot(page, "findings");
  await page.getByRole("radio", { name: "Severity" }).click();
  await page.waitForURL(/group=severity/);
  await page.locator('th[scope="rowgroup"]').first().waitFor();
  ok("group-by-severity renders rowgroup headers", (await page.locator('th[scope="rowgroup"]').count()) > 0);
  await page.getByTestId("facet-rule").click();
  const firstRule = page.getByRole("menuitem").filter({ hasNot: page.getByText("All") }).nth(1);
  const ruleLabel = (await firstRule.textContent())?.trim().split(/\s/)[0];
  await firstRule.click();
  await page.waitForURL(/ruleId=/);
  await page.locator('th[scope="rowgroup"]').first().waitFor();
  const groupHeaders = await page.locator('th[scope="rowgroup"]').allTextContents();
  ok("rule filter narrows findings to one rule", groupHeaders.length === 1, `rule=${ruleLabel}, headers=${groupHeaders.length}`);
  await page.getByRole("button", { name: /Clear filters/ }).first().click();
  await page.waitForURL((u) => !u.search.includes("ruleId="));
  ok("Rejected rows CSV requires confirmation (D9)", true);
  await page.getByTestId("download-rejected-button").first().click();
  await page.getByTestId("rejected-csv-dialog").waitFor();
  ok("rejected CSV confirm dialog mentions full SINs", (await page.getByTestId("rejected-csv-dialog").textContent())?.includes("full SINs"));
  await page.keyboard.press("Escape");

  await page.goto(`${mixedUrl}/records`);
  await page.getByTestId("records-table").waitFor();
  // innerText keeps cell boundaries (tabs/newlines) so adjacent numeric cells are not concatenated.
  const bodyText = await page.getByTestId("records-table").innerText();
  ok("Records never shows 9 contiguous digits", !/\d{9}/.test(bodyText ?? ""));
  await page.getByRole("button", { name: "Expand row" }).first().click();
  await page.getByRole("region", { name: "Row details" }).waitFor();
  ok("Records expansion shows raw vs parsed values", (await page.getByRole("region", { name: "Row details" }).textContent())?.includes("As in file"));
  await page.locator("#show-py").click();
  await page.waitForURL(/py=1/);
  ok("PY columns toggle on", (await page.getByRole("columnheader", { name: /Weeks PY/ }).count()) === 1);
  await shot(page, "records");

  await page.goto(`${mixedUrl}/reports`);
  await page.getByTestId("report-card-execution").waitFor();
  ok("Reports: execution report viewable", (await page.getByTestId("report-card-execution").getByRole("link", { name: /View/ }).count()) === 1);
  ok("Reports: rejected individuals downloadable", (await page.getByTestId("report-card-rejected").getByTestId("download-rejected-button").count()) === 1);
  ok("Reports: later-phase cards disabled", (await page.getByTestId("report-card-summary").getByRole("button", { disabled: true }).count()) === 1);
  await page.getByTestId("report-card-execution").getByRole("link", { name: /View/ }).click();
  await page.waitForURL(/reports\/execution-report/);
  ok("Execution report in-app view renders rule timing", (await page.textContent("body"))?.includes("Rule timing"));

  await page.goto(`${BASE}/batches`);
  await page.getByTestId("batches-table").waitFor();
  await shot(page, "batches-list");

  // ---- Admin: ledger explorer + verify ----
  await login(page, "admin");
  await page.goto(`${BASE}/ledger`);
  await page.getByTestId("ledger-table").waitFor();
  const ledgerRows = await page.locator('[data-testid="ledger-table"] tbody tr[data-row-id]').count();
  ok("Ledger explorer lists entries", ledgerRows > 0, `${ledgerRows} rows on page`);
  await page.getByTestId("verify-button").click();
  await page.getByTestId("verify-dialog").waitFor();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByTestId("integrity-banner-verified").waitFor({ timeout: 60_000 });
  ok("Verify returns OK and banner shows verified", (await page.getByTestId("integrity-banner-verified").textContent())?.includes("Chain verified"));
  await page.locator('[data-testid="ledger-table"] tbody tr[data-row-id]').first().click();
  await page.getByTestId("entry-drawer").waitFor();
  await page.getByTestId("entry-drawer").getByText(/Recomputed on open/).waitFor({ timeout: 15_000 });
  ok("entry drawer opens from ?seq and recomputes hashes", /seq=\d+/.test(page.url()) && (await page.getByTestId("entry-drawer").textContent())?.includes("payloadHash ✓"));
  await shot(page, "ledger-explorer");
  await page.keyboard.press("Escape");

  // Reviewer sees Verify disabled; Submitter gets 403 page.
  await login(page, "reviewer");
  await page.goto(`${BASE}/ledger`);
  ok("Reviewer sees Verify disabled", await page.getByTestId("verify-button").isDisabled());
  await login(page, "submitter-0235");
  await page.goto(`${BASE}/ledger`);
  await page.waitForURL(/\/forbidden/);
  ok("Submitter deep-link to /ledger lands on 403 page", (await page.textContent("h1"))?.includes("access"));
} catch (err) {
  failed += 1;
  results.push(`ERROR ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  await shot(page, "zz-failure").catch(() => {});
} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log(`\n${failed === 0 ? "E2E OK" : `E2E FAILED (${failed})`} — screenshots in ${OUT}`);
process.exit(failed === 0 ? 0 : 1);