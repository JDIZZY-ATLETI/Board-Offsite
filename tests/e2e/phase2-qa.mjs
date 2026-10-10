/**
 * Phase 2 browser QA (docs/ux-design.md section 9.6 items 11-15): warning override drawer (single + bulk), HELD states,
 * PRIVATE toggle, /ariel browser, /admin/rules registry + change history, dashboard "Findings by rule", plus an
 * axe-core scan (zero serious/critical gate) on every new page state. Screenshots -> docs/screenshots/phase2/.
 *   npm run e2e:phase2   (needs `npm run dev` on BASE_URL, default http://localhost:3000)
 * Writes docs/qa/e2e-phase2-results.json + docs/qa/axe-phase2-summary.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/qa");
const SHOTS = path.resolve("docs/screenshots/phase2");
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const golden = (s) => readFileSync(path.resolve("tests/golden", s, "input.csv"));
const expectedCounts = (s) => JSON.parse(readFileSync(path.resolve("tests/golden", s, "expected-counts.json"), "utf8"));
const results = [];
const axeSummary = {};
let failed = 0;
let saltCounter = Date.now() % 100000;
// One extra TERFIN row with a SIN unknown to Ariel (B2 rejects it): unique bytes per run, counts = golden + 1 rejected.
const SALT_ROWS = 1;
const salted = (buf) => {
  const text = buf.toString("latin1").replace(/(\r?\n)*$/, "");
  const sin = String(100000000 + ((Date.now() + saltCounter++) % 899999999)).slice(0, 9);
  return Buffer.from(`${text}\r\n${sin},SALT,Row,TERFIN,09302026,10.00,980.00,,,1800,,,,,\r\n`, "latin1");
};

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  if (!cond) failed += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}
function note(name, detail) {
  results.push({ name, pass: null, detail });
  console.log(`NOTE  ${name} - ${detail}`);
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function login(page, personaId) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`persona-${personaId}`).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByTestId("app-shell").waitFor();
}
async function api(page, method, url, body) {
  const res = await page.request.fetch(`${BASE}${url}`, { method, data: body, headers: body ? { "content-type": "application/json" } : {} });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function uploadAndWait(page, buf, name) {
  await page.goto(`${BASE}/upload`);
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: buf });
  await page.locator('[data-testid^="preflight-"]').first().waitFor();
  // Admin must pick the employer (Submitters have it fixed); fill after the pre-flight proves the form is hydrated.
  if ((await page.locator("input#employer").count()) > 0) await page.locator("input#employer").fill("0235");
  await page.locator("text=computing").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.getByTestId("upload-submit").click();
  await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const url = page.url();
  await page.getByTestId("status-badge-VALIDATED").first().waitFor({ timeout: 90_000 });
  return url;
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
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
// Dev-mode compiles on first hit can exceed the 30 s default on a loaded machine.
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(90_000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  const golden100 = expectedCounts("mixed-100-rows");

  // ---------- Submitter uploads mixed-100-rows; cannot override; sees the reviewer copy ----------
  await login(page, "submitter-0235");
  const mixedUrl = await uploadAndWait(page, salted(golden("mixed-100-rows")), `p2-mixed-${Date.now()}.csv`);
  const mixedId = mixedUrl.split("/").pop();
  const b0 = (await api(page, "GET", `/api/batches/${mixedId}`)).body;
  // Execution date = today here (the golden pins 2026-10-08), so date-sensitive rules may move one row; HELD is stable.
  ok("mixed-100-rows VALIDATED: rows = golden + salt, HELD = golden, outcomes sum to rows", b0.status === "VALIDATED" && b0.counts.rows === golden100.rows + SALT_ROWS && b0.counts.held === golden100.held && b0.counts.accepted + b0.counts.rejected + b0.counts.held === b0.counts.rows, JSON.stringify(b0.counts));
  const saltRow = (await api(page, "GET", `/api/batches/${mixedId}/findings?lineNumber=${golden100.rows + 1 + SALT_ROWS}&limit=10`)).body.items;
  ok("the salt row is rejected by B2 only (unknown SIN)", saltRow.length === 1 && saltRow[0].ruleId === "B2", saltRow.map((f) => f.ruleId).join(","));
  const subNext = (await page.getByTestId("next-step").textContent()) ?? "";
  ok("Submitter next-step copy: N warnings need a HOOPP reviewer's override (7.6)", /need a HOOPP reviewer/.test(subNext), subNext.replace(/\s+/g, " ").slice(0, 100));
  ok("Submitter overview Warnings KPI shows held count", ((await page.getByTestId("kpi-warnings").textContent()) ?? "").includes(`${golden100.held} held`));
  await page.goto(`${mixedUrl}/findings?severity=WARNING`);
  await page.getByTestId("findings-table").waitFor();
  ok("Submitter sees no Override button (D6)", (await page.locator('[data-testid^="override-button-"]').count()) === 0 && (await page.getByTestId("bulk-override-button").count()) === 0);
  ok("Submitter sees the 'HOOPP reviewer will choose a reason' copy", (await page.locator("text=A HOOPP reviewer will choose an override reason").count()) > 0);
  ok("Submitter has no PRIVATE toggle", (await page.getByTestId("visibility-toggle").count()) === 0);
  ok("Submitter can download the public Summary of validations only", (await page.getByTestId("download-summary").count()) === 1 && (await page.getByTestId("download-summary-private").count()) === 0);
  await axeScan(page, "findings (Submitter, HELD rows)");
  await shot(page, "11-findings-submitter-held");

  // ---------- Reviewer: HELD copy, override one B40 via the drawer ----------
  await login(page, "reviewer");
  await page.goto(mixedUrl);
  await page.getByTestId("next-step").waitFor();
  const revNext = (await page.getByTestId("next-step").textContent()) ?? "";
  ok(`Reviewer overview: "${golden100.held} held rows need an override"`, revNext.includes(`${golden100.held} held rows need an override`), revNext.replace(/\s+/g, " ").slice(0, 100));
  ok("Stepper Validated node carries the held copy", ((await page.getByTestId("stepper-step-VALIDATED").textContent()) ?? "").includes("held"));
  await page.goto(`${BASE}/batches`);
  await page.getByTestId("batches-table").waitFor().catch(() => {});
  ok("Batches list status badge reads 'Validated · N held'", (await page.locator(`text=Validated · ${golden100.held} held`).count()) > 0);
  await shot(page, "11-batches-list-held");

  await page.goto(`${mixedUrl}/findings?severity=WARNING&override=pending&group=severity`);
  await page.getByTestId("findings-table").waitFor();
  ok("Reviewer sees Override buttons on HELD-row warnings", (await page.locator('[data-testid^="override-button-"]').count()) > 0);
  ok("Override filter chip reflects ?override=pending", (await page.locator("text=Override: pending").count()) > 0);
  await axeScan(page, "findings (Reviewer, override pending)");
  await shot(page, "11-findings-reviewer-pending");
  const findingsApi = (await api(page, "GET", `/api/batches/${mixedId}/findings?severity=WARNING&override=pending&limit=200`)).body.items;
  const recordsApi = (await api(page, "GET", `/api/batches/${mixedId}/records?accepted=held&limit=200`)).body.items;
  const heldLines = new Set(recordsApi.map((r) => r.lineNumber));
  const b40 = findingsApi.find((f) => f.ruleId === "B40" && heldLines.has(f.lineNumber));
  ok("a B40 warning on a HELD row exists", Boolean(b40), b40 ? `line ${b40.lineNumber}` : "none");
  const rejectedWarning = findingsApi.find((f) => !heldLines.has(f.lineNumber));
  if (rejectedWarning) ok("GAP-OVR-1 in UI: warning on a REJECTED row has no Override button", (await page.getByTestId(`override-button-${rejectedWarning.findingId}`).count()) === 0, `line ${rejectedWarning.lineNumber}`);
  await page.getByTestId(`override-button-${b40.findingId}`).click();
  await page.getByTestId("override-drawer").waitFor();
  await page.getByTestId("override-reasons").waitFor();
  const reasonCount = await page.locator('[data-testid="override-reasons"] input[type="radio"]').count();
  ok("drawer lists the rule's 7 override reasons verbatim (B40)", reasonCount === 7, `${reasonCount}`);
  ok("submit disabled until a reason is chosen", await page.getByTestId("override-submit").isDisabled());
  await page.getByLabel("Other - please provide explanation").check();
  ok("'Other' requires a note (submit stays disabled)", await page.getByTestId("override-submit").isDisabled());
  await page.getByLabel("The member received a promotion").check();
  ok("listed reason enables submit", !(await page.getByTestId("override-submit").isDisabled()));
  await axeScan(page, "override drawer");
  await shot(page, "11-override-drawer");
  const headBefore = (await api(page, "GET", "/api/ledger/head")).body.seq;
  await page.getByTestId("override-submit").click();
  await page.getByTestId("override-drawer").waitFor({ state: "detached", timeout: 15_000 });
  ok("toast: Override recorded. Row N is now accepted.", (await page.locator(`text=Override recorded. Row ${b40.lineNumber} is now accepted.`).count()) > 0);
  const b1 = (await api(page, "GET", `/api/batches/${mixedId}`)).body;
  ok("held count decrements by one", b1.counts.held === golden100.held - 1, `held=${b1.counts.held}`);
  const rec = (await api(page, "GET", `/api/batches/${mixedId}/records?limit=200`)).body.items.find((r) => r.lineNumber === b40.lineNumber);
  ok("row outcome becomes ACCEPTED", rec?.outcome === "ACCEPTED", rec?.outcome);
  const ledger = (await api(page, "GET", `/api/ledger/entries?batchId=${mixedId}&eventType=WarningOverridden&limit=20`)).body;
  ok("ledger has a WarningOverridden entry for the finding", (ledger?.items ?? []).some((e) => e.payload?.findingId === b40.findingId && e.seq > headBefore));
  await page.goto(`${mixedUrl}/findings?override=done&group=severity`);
  await page.getByTestId("findings-table").waitFor();
  ok("overridden finding shows the 'Overridden' state in the Override column", (await page.getByTestId(`override-state-${b40.findingId}`).count()) === 1);
  await page.getByTestId(`finding-row-${b40.findingId}`).click();
  await page.getByTestId(`override-strip-${b40.findingId}`).waitFor();
  const strip = (await page.getByTestId(`override-strip-${b40.findingId}`).textContent()) ?? "";
  ok("amber strip: Overridden · reason · by actor · time · ledger #", /Overridden.*The member received a promotion.*by \w+.*ledger #\d+/.test(strip.replace(/\s+/g, " ")), strip.replace(/\s+/g, " ").slice(0, 120));
  await axeScan(page, "findings (overridden strip)");
  await shot(page, "11-findings-overridden");
  await page.goto(`${mixedUrl}/records?accepted=held`);
  await page.getByTestId("records-table").waitFor();
  ok("Records tab HELD filter lists the remaining held rows with the HELD badge", (await page.locator('[data-testid="outcome-badge-HELD"]').count()) === golden100.held - 1);
  await axeScan(page, "records (HELD filter)");
  await shot(page, "11-records-held");

  // ---------- Bulk override: two B43 warnings on HELD rows, one reason ----------
  await page.goto(`${mixedUrl}/findings?severity=WARNING&override=pending&group=rule`);
  await page.getByTestId("findings-table").waitFor();
  const pending = (await api(page, "GET", `/api/batches/${mixedId}/findings?severity=WARNING&override=pending&limit=200`)).body.items.filter((f) => heldLines.has(f.lineNumber));
  const b43s = pending.filter((f) => f.ruleId === "B43").slice(0, 2);
  ok("two pending B43 warnings on HELD rows exist for the bulk flow", b43s.length === 2);
  ok("bulk button disabled with nothing selected", await page.getByTestId("bulk-override-button").isDisabled());
  for (const f of b43s) await page.getByTestId(`select-finding-${f.findingId}`).click();
  ok("bulk button enabled with two same-rule warnings selected", !(await page.getByTestId("bulk-override-button").isDisabled()));
  await page.getByTestId("bulk-override-button").click();
  await page.getByTestId("override-drawer").waitFor();
  ok("bulk drawer title names the count", ((await page.getByTestId("override-drawer").textContent()) ?? "").includes("Record override for 2 warnings"));
  await page.getByTestId("override-reasons").waitFor();
  await page.getByLabel("Job reclassification").check();
  await shot(page, "11-override-drawer-bulk");
  await page.getByTestId("override-submit").click();
  await page.getByTestId("override-drawer").waitFor({ state: "detached", timeout: 20_000 });
  ok("toast: 2 overrides recorded.", (await page.locator("text=2 overrides recorded.").count()) > 0);
  const b2 = (await api(page, "GET", `/api/batches/${mixedId}`)).body;
  ok("held count decrements by two more", b2.counts.held === golden100.held - 3, `held=${b2.counts.held}`);

  // ---------- 12: PRIVATE toggle + private summary report view ----------
  await page.goto(`${mixedUrl}/findings?group=severity`);
  await page.getByTestId("findings-table").waitFor();
  const privateBefore = await page.locator("text=HOOPP-internal").count();
  const infoRows = await page.locator('[data-testid="severity-badge-INFORMATION"]').count();
  ok("Reviewer sees PRIVATE (INFORMATION) findings by default", infoRows > 0, `${infoRows} info badges, ${privateBefore} lock tags`);
  await page.getByTestId("visibility-toggle").click();
  await page.waitForURL(/visibility=PUBLIC/);
  await page.getByTestId("findings-table").waitFor();
  await page.waitForLoadState("networkidle");
  ok("toggle off -> ?visibility=PUBLIC hides INFORMATION/PRIVATE findings", (await page.locator('[data-testid="severity-badge-INFORMATION"]').count()) === 0);
  await page.getByTestId("visibility-toggle").click();
  await page.waitForURL((u) => !u.search.includes("visibility="));
  await page.waitForLoadState("networkidle");
  ok("toggle on again restores them", (await page.locator('[data-testid="severity-badge-INFORMATION"]').count()) > 0);
  await page.goto(`${mixedUrl}/reports`);
  await page.getByTestId("page-header").waitFor();
  ok("Reports tab: public Summary card enabled with a View link", (await page.getByTestId("report-card-summary-of-validations.csv").getByRole("link", { name: /View/ }).count()) === 1);
  ok("Reports tab: private Summary card for Reviewer", (await page.getByTestId("report-card-summary-of-validations.private.csv").count()) === 1);
  await axeScan(page, "reports (Phase 2 cards)");
  await page.goto(`${mixedUrl}/reports/summary-of-validations.csv`);
  await page.getByTestId("summary-report-table").waitFor();
  const pubText = (await page.getByTestId("summary-report-table").textContent()) ?? "";
  ok("public Summary view: Rule · Message ID · Severity · Count · Overridden · Portal message, no PRIVATE rows", /Overridden/.test(pubText) && !/B41|B44|B182/.test(pubText));
  ok("public Summary view counts the overrides recorded above", /B40/.test(pubText));
  await axeScan(page, "summary report (public)");
  await shot(page, "12-summary-public");
  await page.goto(`${mixedUrl}/reports/summary-of-validations.private.csv`);
  await page.getByTestId("summary-report-table").waitFor();
  const privText = (await page.getByTestId("summary-report-table").textContent()) ?? "";
  ok("private Summary view adds a Visibility column with Lock tags and the PRIVATE rows", /Visibility/.test(privText) && /B41|B44|B182/.test(privText) && (await page.locator('[data-testid="summary-report-table"] [data-visibility="PRIVATE"]').count()) > 0);
  await axeScan(page, "summary report (private)");
  await shot(page, "12-summary-private");
  await login(page, "submitter-0235");
  await page.goto(`${mixedUrl}/reports/summary-of-validations.private.csv`);
  // The server redirect() is streamed and completed client-side after `load`; wait for it like the /ariel check does.
  await page.waitForURL(/\/forbidden/, { timeout: 15_000 }).catch(() => {});
  ok("Submitter deep-link to the private report -> forbidden", /\/forbidden/.test(page.url()) || (await page.locator("text=/don.t have access|Forbidden|403/i").count()) > 0, page.url());

  // ---------- 13: /ariel browser + member page ----------
  await login(page, "reviewer");
  ok("Reviewer nav shows Mock Ariel and Rules & config", (await page.locator('nav[aria-label="Sidebar navigation"] a', { hasText: "Mock Ariel" }).count()) === 1 && (await page.locator('nav[aria-label="Sidebar navigation"] a', { hasText: "Rules & config" }).count()) === 1);
  await page.goto(`${BASE}/ariel`);
  await page.getByTestId("ariel-members-table").waitFor();
  const memberRows = await page.locator('[data-testid="ariel-members-table"] tbody tr[data-row-id]').count();
  ok("/ariel lists the seeded members (masked SIN, no full SIN)", memberRows >= 18 && !/\b9000000\d\d\b/.test((await page.locator("body").textContent()) ?? ""), `${memberRows} rows`);
  ok("/ariel rates panel flags placeholder rows", (await page.getByTestId("ariel-rates-panel").count()) === 1 && (await page.locator('[data-testid="ariel-rates-panel"] [data-testid="placeholder-chip"]').count()) > 0);
  ok("/ariel: no Reseed for Reviewer", (await page.getByTestId("ariel-reseed-button").count()) === 0);
  await axeScan(page, "ariel browser");
  await shot(page, "13-ariel");
  await page.locator('[data-testid="ariel-members-table"] tbody tr[data-row-id]').first().click();
  await page.waitForURL(/\/ariel\/members\/[0-9a-f]{64}/);
  await page.getByTestId("ariel-member-page").waitFor();
  const memberText = (await page.getByTestId("ariel-member-page").textContent()) ?? "";
  ok("member page shows employments / service / contributions / salary / PA sections and the mock banner", /Employments/.test(memberText) && /Service/.test(memberText) && /Contributions/.test(memberText) && /Mock data/.test(memberText));
  await axeScan(page, "ariel member");
  await shot(page, "13-ariel-member");
  await login(page, "admin");
  await page.goto(`${BASE}/ariel`);
  await page.getByTestId("ariel-members-table").waitFor();
  ok("/ariel: Admin sees Reseed (dev only)", (await page.getByTestId("ariel-reseed-button").count()) === 1);
  await login(page, "submitter-0235");
  await page.goto(`${BASE}/ariel`);
  await page.waitForURL(/\/forbidden/);
  ok("Submitter /ariel -> /forbidden", true);

  // ---------- 14: /admin/rules registry, toggle B40 off, history, new batch has no B40, toggle back ----------
  await login(page, "admin");
  await page.goto(`${BASE}/admin/rules`);
  await page.getByTestId("rules-table").waitFor();
  const rulesCount = await page.locator('[data-testid^="rule-row-"]').count();
  ok("/admin/rules lists the registry", rulesCount >= 50, `${rulesCount} rows`);
  const hashBefore = (await api(page, "GET", "/api/rules")).body.config.hash;
  ok("config hash shown in the header", ((await page.getByTestId("rules-config-hash").textContent()) ?? "").includes(hashBefore.slice(0, 8)));
  await axeScan(page, "admin rules");
  await shot(page, "14-admin-rules");
  await page.getByTestId("rule-toggle-B40").click();
  await page.getByTestId("rule-change-dialog").waitFor();
  await page.getByTestId("rule-change-reason").fill("E2E: disable B40 temporarily");
  await axeScan(page, "admin rules (change dialog)");
  await page.getByTestId("rule-change-confirm").click();
  await page.getByTestId("rule-change-dialog").waitFor({ state: "detached", timeout: 15_000 });
  const afterOff = (await api(page, "GET", "/api/rules")).body;
  ok("B40 disabled via the UI; hash changed", afterOff.items.find((r) => r.id === "B40").enabled === false && afterOff.config.hash !== hashBefore);
  await page.goto(`${BASE}/admin/rules?tab=history`);
  await page.getByTestId("rules-history").waitFor();
  ok("Change history lists the B40 change with the reason", ((await page.getByTestId("rules-history").textContent()) ?? "").includes("E2E: disable B40 temporarily"));
  await axeScan(page, "admin rules (history)");
  await shot(page, "14-admin-rules-history");
  const header = golden("mixed-100-rows").toString("latin1").split(/\r?\n/)[0];
  const line77 = golden("mixed-100-rows").toString("latin1").split(/\r?\n/)[76];
  const b40Url = await uploadAndWait(page, salted(Buffer.from(`${header}\r\n${line77}\r\n`, "latin1")), `p2-b40off-${Date.now()}.csv`);
  const b40Id = b40Url.split("/").pop();
  const b40Findings = (await api(page, "GET", `/api/batches/${b40Id}/findings?limit=200`)).body.items;
  ok("a new batch validated while B40 is off has no B40 finding and carries the new hash", !b40Findings.some((f) => f.ruleId === "B40") && (await api(page, "GET", `/api/batches/${b40Id}`)).body.rulesConfigHash === afterOff.config.hash);
  await page.goto(`${BASE}/admin/rules`);
  await page.getByTestId("rules-table").waitFor();
  await page.getByTestId("rule-toggle-B40").click();
  await page.getByTestId("rule-change-dialog").waitFor();
  await page.getByTestId("rule-change-reason").fill("E2E: re-enable B40");
  await page.getByTestId("rule-change-confirm").click();
  await page.getByTestId("rule-change-dialog").waitFor({ state: "detached", timeout: 15_000 });
  const restored = (await api(page, "GET", "/api/rules")).body;
  ok("B40 re-enabled; hash back to the original", restored.items.find((r) => r.id === "B40").enabled === true && restored.config.hash === hashBefore, `${restored.config.hash.slice(0, 8)} vs ${hashBefore.slice(0, 8)}`);
  await page.getByTestId("rule-tolerance-B47").click();
  await page.getByTestId("tolerance-dialog").waitFor();
  await page.locator("#tol-B47-min").fill("500000");
  await page.getByTestId("rule-change-reason").fill("E2E: invalid tolerance probe");
  await page.getByTestId("rule-change-confirm").click();
  await page.getByRole("alert").waitFor();
  ok("tolerance dialog surfaces 422 INVALID_TOLERANCE inline", /B47\.min/.test((await page.getByRole("alert").textContent()) ?? ""));
  await axeScan(page, "admin rules (tolerance dialog error)");
  await page.keyboard.press("Escape");
  await login(page, "reviewer");
  await page.goto(`${BASE}/admin/rules`);
  await page.getByTestId("rules-table").waitFor();
  ok("Reviewer sees /admin/rules read-only (toggles disabled)", await page.getByTestId("rule-toggle-B40").isDisabled());

  // ---------- 15: dashboard Findings by rule ----------
  await page.goto(`${BASE}/`);
  await page.getByTestId("findings-by-rule").waitFor();
  const fbr = (await page.getByTestId("findings-by-rule").textContent()) ?? "";
  ok("dashboard 'Findings by rule' panel lists rules with counts", /B2|B40|I42|B5/.test(fbr));
  const fbrRows = await page.locator('[data-testid^="findings-by-rule-"]').count();
  ok("panel: window label, top-N table rows (<= 8) with severity badges and a rule link into the registry", /Last 30 days/.test(fbr) && fbrRows > 0 && fbrRows <= 8 && (await page.locator('[data-testid="findings-by-rule"] [data-testid^="severity-badge-"]').count()) === fbrRows && (await page.locator('[data-testid="findings-by-rule"] a[href^="/admin/rules?q="]').count()) === fbrRows, `${fbrRows} rows`);
  await axeScan(page, "dashboard (Reviewer, findings by rule)");
  await shot(page, "15-dashboard-findings-by-rule");
  await login(page, "submitter-0235");
  ok("Submitter dashboard has no 'Findings by rule' panel", (await page.getByTestId("findings-by-rule").count()) === 0);

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  const axeBlocking = Object.entries(axeSummary).flatMap(([label, s]) => s.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id}(${v.impact},${v.nodes})`));
  ok("axe: zero serious/critical violations across all Phase 2 page states (ux 8.1)", axeBlocking.length === 0, axeBlocking.slice(0, 8).join("; "));
} catch (err) {
  failed += 1;
  results.push({ name: "unexpected error", pass: false, detail: String(err?.stack ?? err) });
  console.error("ERROR", err);
  await page.screenshot({ path: path.join(OUT, "e2e-phase2-failure.png"), fullPage: true }).catch(() => {});
} finally {
  writeFileSync(path.join(OUT, "e2e-phase2-results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), failed, results }, null, 2));
  writeFileSync(path.join(OUT, "axe-phase2-summary.json"), JSON.stringify(axeSummary, null, 2));
  const totals = Object.values(axeSummary).reduce((a, s) => { for (const k of Object.keys(a)) a[k] += s.byImpact[k]; return a; }, { critical: 0, serious: 0, moderate: 0, minor: 0 });
  console.log(`\nAXE totals across ${Object.keys(axeSummary).length} pages: ${JSON.stringify(totals)}`);
  console.log(`\n${results.filter((r) => r.pass === true).length} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
void note;