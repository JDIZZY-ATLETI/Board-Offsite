# Phase 1 QA Report - HOOPP Events Validation Ledger

Independent QA pass against `docs/architecture.md` section 17 "Phase 1 - Foundation" (AC1-AC7), the v15.1 validation spec and `docs/ux-design.md`. Executed 2026-10-09 on Windows / Node 22.23.2 / PGlite (`DB_DRIVER=pglite`). Report is the single source for release sign-off; every claim cites a test name, command or artifact.

## 1. Gate results + coverage

| Gate | Before QA | After QA (this branch) |
|---|---|---|
| `npm run typecheck` | pass | pass |
| `npm run lint` | pass (0 warnings) | pass (0 warnings) |
| `npm run lint:pii` | pass | pass |
| `npm run test:coverage` | 39 files, **193 passed, 1 skipped** | 43 files, **409 passed, 1 skipped** (+216) |
| Coverage (lines / branches / functions, `src/lib/**`) | 90.02 % / 82.65 % / 88.66 % | **92.16 % / 87.02 % / 89.20 %** |
| `src/lib/rules/**` lines | 100 % | 100 % (534/534) |
| `src/lib/auth/dev-session.ts` | **0 %** | 100 % |
| `npm run build` | Compiled successfully | Compiled successfully (12.9 s); shared First Load JS 103 kB; largest routes `/ledger` 200 kB, `/batches` 197 kB, `/upload` 18 kB page / 171 kB total; middleware 33.9 kB |
| `npm audit` | 21 advisories: **2 critical, 9 high**, 10 moderate (all in devDependencies / build tooling, see section 5) | unchanged (+ `axe-core` dev dep, clean) |
| `npm run e2e:phase1` (existing browser E2E) | 31/31 PASS | 31/31 PASS |
| `npm run e2e:qa` (new) | - | **42 PASS, 0 FAIL, 4 known gaps, 1 note**; axe: 0 critical / 32 serious / 22 moderate / 3 minor across 15 page states |
| `npm run test:perf` (new, opt-in) | - | 5/5 PASS, numbers in section 7 |

The one skipped test (`tests/unit/ledger.spec.ts` "UPDATE as the restricted app role") is Postgres-only (GRANT-based); it cannot run on PGlite and remains **unverified on this machine** (no Docker/Postgres).

## 2. AC1-AC7 verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1 clean clone -> `db:migrate` -> `dev` works from `.env.example` | **PASS (PGlite path)** / NOT VERIFIED (Docker Postgres path) | Dev server started from a fresh `.env` copy for both E2E runs; migrations applied (`[db:migrate] done`). No Docker on this machine, so the `postgres` driver branch, the GRANT block in `drizzle/0001` and `docker compose up` were not exercised. |
| AC2 `file-rejected-header` -> FILE_REJECTED with I51; `happy-terfin` -> PARSED -> VALIDATED with bronze/silver/manifest + sha256 | **PASS** | `tests/integration/pipeline.spec.ts` (bad header -> I51/4887, L0, no records; happy-terfin status history RECEIVED,PARSED,VALIDATED; manifest.sha256 == file sha256; all 8 lake artifacts exist). Re-confirmed in the browser (`e2e:phase1`: "bad header reaches FILE_REJECTED", "happy-terfin reaches VALIDATED"). |
| AC3 every L0/L1 rule has positive/negative unit tests; `mixed-100-rows` fires every L1 message id | **PASS** | `tests/rules/*.spec.ts` (54 tests, meta-test `registry.spec.ts`) + **135 new boundary probes** in `tests/qa/rules-boundaries.spec.ts`; `pipeline.spec.ts` asserts the exact set of message ids and rejected lines for `mixed-100-rows`. |
| AC4 re-upload returns `duplicate:true`, no second batch | **PASS** | `tests/qa/adversarial-upload.spec.ts` "duplicate content: same employer -> same batchId regardless of filename/uploader" and "appends BatchReceived{duplicateOf} to the EXISTING batch stream"; `tests/qa/ledger-integrity.spec.ts` "parallel uploads of identical bytes ... exactly one batch" (unique-index race). Caveat BUG-PIPE-3: FAILED batches also deduplicate. |
| AC5 `POST /api/ledger/verify` ok; tampering -> correct `firstBadSeq`; UPDATE rejected by trigger | **PASS (PGlite)** | `tests/unit/ledger.spec.ts` (tamper -> firstBadSeq 2 / 4), `tests/qa/ledger-integrity.spec.ts` (UPDATE/DELETE/TRUNCATE/forged INSERT refused; deleted tail detected via heads check; failing tx leaves no entries; 600-entry chunk chains correctly; independent chain re-walk after 5 parallel uploads). "UPDATE as app role" (GRANT) is Postgres-only and skipped. |
| AC6 no raw SIN in `events_records`, none in logs | **PASS** | `tests/qa/security-roles.spec.ts` "raw-SIN leak sweep": all 60+ SINs of `mixed-100-rows` absent from every JSON route (all pages), every report except `rejected.csv`, every ledger entry, the captured pino stream (also no `9\d{8}` token at all), every file on disk except `raw/original.csv` + `silver/rejected.csv`, and both DB tables. `rejected.csv` download is audit-logged. |
| AC7 batches list and detail render; findings filterable by severity | **PASS** | `e2e:phase1` (group by severity, rule facet narrows to one rule) and `e2e:qa` (testids, DataTable keyboard map, facets present); `tests/integration/api.spec.ts` severity/rule/visibility filters. |

## 3. Rule conformance (L0/L1 + I42) vs `hoopp-ch7-validations-v15.1.txt`

Verdicts: **conforms** (logic, id, severity, section, messages verbatim), **deviates (documented)** = deliberate, written down in architecture section 18, **ambiguous** = spec silent; implementation choice recorded here. Evidence = `tests/qa/rules-boundaries.spec.ts` unless stated.

| Rule / id | Verdict | Evidence / notes |
|---|---|---|
| I50 / 130 FILE_ERROR | conforms; strictness note | Extra cell on any data row rejects the file, `firstOffendingLine` recorded. A **trailing comma** on a data row (empty 16th cell) is treated as extra data -> I50 (spec silent; legacy behaviour unknown). Mixed CRLF/LF files trigger a **false I50** (BUG-PARSE-1). |
| I51 / 4887 | deviates (documented) + ambiguous | Spec severity says "Complete Member Error" but logic says "reject the input file"; implemented FILE_ERROR per section 18 Q2 - agreed. Header match is **case-sensitive** and whitespace-tolerant (`" SIN "` ok, `"sin"` rejected, `"Last Name"` rejected) - spec silent. Duplicate label -> I51 with `DUPLICATE_HEADER` (spec matrix lists 6926) - documented. Empty/0-byte/whitespace file -> I51 `EMPTY_FILE` (extension). Trailing comma on header -> I51. Column reorder allowed; missing optional column allowed; missing mandatory column -> I1 per row (matches test matrix). |
| I1 / 8233 | conforms; ambiguous on names | Six always-mandatory fields + `EmploymentEndDate` for TERFIN/RETFIN only; whitespace = blank; `"0"` is not blank; one finding per field in layout order; optional fields never fire. Layout table marks LastName/FirstName mandatory but the revision log (v3.2 line 9) says they became non-mandatory - **confirm with HOOPP**. |
| I2 / 2031 | conforms | Whitespace SIN fires; I2 suppresses I10 and all L2 for the row while other L1 rules still run (engine test). |
| I3 / 9519 | conforms | Exact max passes, max+1 fires for all 10 fields (5/8/8/6/5, decimal point counted, surrounding whitespace not counted, minus sign counted). Names not checked (spec note). Both messages render `{File.FieldName}`/`{Max Length}`. |
| I5 / 825 | conforms (+ range extension) | 02302026, 13012026, 04312026, Feb-29 non-leap and 2100, DDMMYYYY, ISO, slashes, sign, inner space, 9 digits all rejected; left padding and leap years accepted; message echoes the trimmed raw value. Year window 1900-2999 is an implementation choice (spec: "invalid value for YYYY"). |
| I7 / 6503 (CY) · 6642 (PY) | conforms; ambiguous id split | >2 dp, thousands separator, exponent, `$`, `%`, `--1` rejected; `12.`, `.5`, `+12.50`, `-12.50`, leading zeros accepted. CY/PY id assignment is the section 18 Q3 assumption. Integer fields never checked by I7. |
| I8 / 5131 | deviates (documented) for SIN | `5.0`, `-1`, `+5`, `1e3`, `1,234`, non-ASCII digits rejected; leading zeros ok. SIN with spaces/dashes/10 digits/letters -> I8 with `{1}="SIN"` and `calculated.masked=true` (section 13.3; the value is never echoed - verified via API too). Short SINs are padded and valid. |
| I9 / 8034 | deviates (documented, adopted) + ambiguous | Spec Section omits Events; adopted per section 18 Q4, config-switchable (`disabled` honoured - tested). **Case-sensitive** (`terfin` rejected) - spec silent. Trims whitespace. |
| I10 / 910 | deviates (documented) | Padded/whitespace variants of one SIN are duplicates; every row rejected; `occurrences` counted; 10-digit near-miss not a duplicate. `{1}` is the **masked** SIN (section 13.3). |
| I32 / 4999 | conforms | Strict `> 0` on both; per-scope findings (2 on one row); zero/blank AE never fires; skips fields that failed format parsing. Portal message verbatim (no trailing period). |
| I55 / 9349 | conforms; ambiguous on blank | Weeks > 0 with Low `0`/`0.00`/`0.0`/`-0` fires; **Low blank does not fire** (blank != $0; CY blank is I1, PY blank is silent). Negative weeks do not fire (B187 owns). |
| B187 x6 / 9099, 4423, 4869, 7902, 494, 5049 | conforms | Each rule watches exactly its field; `-0.01` and ` -5 ` fire with `{0}` = trimmed value; `-0`, `-0.00`, `0`, non-numeric do not; portal labels verbatim (spec trailing double-space trimmed - cosmetic); fires alongside I7/I3 for `-1.234`. |
| I42 / 8106 (Phase-1 runnable L2) | conforms + deviates (documented) | Uses `ctx.batch.executionDate` only (same row flips with a different execution date -> deterministic, no wall clock); event == exec passes, +1 day fires; RETFIN gated by `I42_APPLY_TO_RETFIN` (section 18 Q5); DECFIN uses EmploymentEndDate (Q1); unparseable date left to I5. |
| Engine composition | conforms | `12345.678` -> 9519 **and** 6503 (parsing note); fully broken row yields all applicable L1 messages in registry order; same input twice -> identical findings. |

## 4. Bugs found (ordered by severity)

Test column: `it.fails(...)` = failing-on-purpose test that flips red when the bug is fixed; "current" = test pinning the current (wrong) behaviour so regressions in the other direction are also caught.

| # | Sev | Title | Repro | Expected vs actual | Suggested fix | Test |
|---|---|---|---|---|---|---|
| BUG-SEC-1 | **Critical** (prod only) | `x-user-*` identity headers trusted from any client in production | `NODE_ENV=production`; `curl -H "x-user-id: a" -H "x-user-role: Admin" /api/ledger/verify -X POST` | Expected 401; actual: full Admin session (middleware passes through in production **without stripping** the headers; `HeaderAuthProvider` is the only provider). Phase 1 is dev-only, but this is a one-line-away prod hole. | In `middleware.ts` always delete inbound `x-user-id`/`x-user-role`/`x-role`/`x-employer-id` before bridging the cookie; in production refuse `HeaderAuthProvider` unless a trusted-proxy shared secret header is present (or ship `EntraIdAuthProvider`). | `security-roles.spec.ts` BUG-SEC-1 (`it.fails`) |
| BUG-PIPE-2 | **Major** | NUL byte inside a data cell -> HTTP 500 and an **orphaned RECEIVED batch** | Upload a CSV whose LastName contains `\u0000` (`?wait=true`) | Expected FILE_REJECTED/400; actual `500 INTERNAL_ERROR`, batch stays `RECEIVED` forever (illegal terminal state), `failureReason` null because the FAILED transition itself fails (reason text carries the NUL), and the orphan **shadows re-uploads** of the same bytes (`duplicate:true`). | In `decodeBytes` strip or reject `\u0000` (jsonb/text cannot store it); sanitise `failureReason` before persisting; treat the error path as best-effort with a NUL-free message. | `adversarial-upload.spec.ts` "BUG-PIPE-2 current behaviour" |
| BUG-PIPE-1 | **Major** | UTF-16 (or any NUL-bearing) file -> `FAILED` instead of `FILE_REJECTED`, and the API leaks the raw SQL | Upload `HEADER` encoded UTF-16LE | Expected FILE_REJECTED (I51) or 415; actual FAILED with `failureReason` = full `insert into "validation_findings" (...) params: ...` visible to the Submitter in UI/API. | Detect UTF-16 BOM (FF FE / FE FF) in `decodeBytes` and decode or reject; never persist driver error text - map to a safe message and keep detail in logs. | `adversarial-upload.spec.ts` BUG-PIPE-1 (`it.fails`) + "current behaviour" |
| BUG-PARSE-1 | Major/Minor | Mixed line endings (first break CRLF, later LF) glue rows -> **false I50 file rejection** | `HEADER\r\nROW\nROW\r\n` | Expected 2 rows; actual 1 row with 14 extra cells -> whole file rejected. LF-first mixing parses fine (asymmetric). | `record_delimiter: ["\r\n", "\n", "\r"]` in `parseEventsCsv` options. | `rules-boundaries.spec.ts` BUG-PARSE-1 (`it.fails`) |
| BUG-PARSE-2 | Minor | Line numbers drift +1 after a quoted cell containing CRLF | Row 2 has `"AB\r\nLE"`; row 3 reported as line 5 | Expected lines [2,4]; actual [2,5] (csv-parse `info.lines` counts CR and LF). Affects finding `lineNumber` and rejected-row mapping. | Count physical lines at record start (or `info.lines` minus embedded `\r`). | `rules-boundaries.spec.ts` BUG-PARSE-2 (`it.fails`) |
| BUG-API-1 | Minor | `executionDate` only shape-validated | Admin upload with `executionDate=2026-13-45` | Expected 400; actual accepted, stored, used by I42 as a string compare. | zod `.refine()` with a real calendar check (reuse `parseDateField` logic). | `adversarial-upload.spec.ts` BUG-API-1 (`it.fails`) |
| BUG-PIPE-3 | Minor | FAILED batches participate in dedup | Any FAILED batch, re-upload same bytes | Expected a new batch (there is no retry API in Phase 1); actual `duplicate:true` pointing at the FAILED batch - user is stuck. | Exclude `FAILED` in `findExistingBatch` (like FILE_REJECTED) until Admin retry ships. | covered inside BUG-PIPE-2 test |
| BUG-RENDER-1 | Minor - **FIXED** | `hasUnresolvedPlaceholders` used a shared `/g` regex (stateful `lastIndex`) -> false negatives on consecutive calls | `hasUnresolvedPlaceholders("{1} x"); hasUnresolvedPlaceholders("{2}")` returned `false` | Fixed in `src/lib/rules/render.ts` (1 line, fresh non-global regex). | - | `rules-boundaries.spec.ts` "render helpers" |
| BUG-UI-2 | Minor | Not-found pages answer **HTTP 200** and the batch-scoped copy never shows | `GET /batches/<unknown uuid>`, `/batches/not-a-uuid` | Expected 404 + "We couldn't find that batch"; actual 200 (streaming has already flushed) + generic "We couldn't find that page" because `notFound()` is thrown from the segment **layout**, which its own `not-found.tsx` cannot catch. | Throw `notFound()` from the page (or move the batch lookup guard above the streamed layout); add a `not-found.tsx` one level up with the batch copy. | `e2e:qa` gaps BUG-UI-2a/2b |
| BUG-UI-3 | Minor (a11y) | Rejected-CSV confirm dialog does not return focus to its trigger on Esc | Findings tab -> "Download rejected rows" -> Esc | Expected focus on the button (ux 8.1); actual `document.activeElement === body`. | Controlled Radix Dialog without `DialogTrigger`: add `onCloseAutoFocus={() => triggerRef.current?.focus()}`. | `e2e:qa` gap BUG-UI-3 |
| BUG-UI-4 | Minor (a11y) | `aria-expanded` on `<tr>` (role=row) | Any expandable DataTable (Findings 41 rows, Records 100 rows) | axe `aria-conditional-attr` **serious** on every row. | Keep `aria-expanded` on the expand button only (`data-table.tsx` lines 231/247). | axe-summary.json |
| GAP-D12 | Minor (spec) | Mobile (< 1024 px) read-only not implemented | 768 px viewport -> `/upload` | Expected disabled upload + "Use a desktop browser" note; actual fully functional upload form. | Implement D12 or get the decision changed. | `e2e:qa` gap D12 |
| GAP-LEDGER-1 | Minor | `verify()` with a reversed or empty range returns `ok:true, checked:0` | `POST /api/ledger/verify {"fromSeq":5,"toSeq":2}` | Expected 400 or `ok:false`; actual an ambiguous success that is then **ledgered** as a successful verification. | Validate `fromSeq <= toSeq` (400) and require `checked > 0` for `ok`. | `ledger-integrity.spec.ts` GAP-LEDGER-1 (`it.fails`) |
| COS-1 | Cosmetic | ux 9.5 testid `ledger-row-{seq}` missing (rows use `data-row-id`) | `/ledger` | - | Add the testid. | `e2e:qa` note |
| COS-2 | Cosmetic | 0-byte / whitespace-only upload creates a FILE_REJECTED batch instead of a 400 | `POST /api/batches` with empty file | Legal state, but noise in the batch list and ledger. | Reject `size === 0` at the boundary. | `adversarial-upload.spec.ts` |
| COS-3 | Cosmetic | Row-count pre-check counts `\n` only | CR-only file | 50,000-row cap bypassed for CR-only files (20 MB cap still applies; `LINE_TOO_LONG` then rejects any CR-only file > 4 KB). | Count `\r` too, or run the check after decode. | - |

Trivial fixes applied to `src/`: **one** (BUG-RENDER-1, `src/lib/rules/render.ts`, 1 line + comment). No other application code was changed.

## 5. Security findings

| # | Sev | Finding | Status / evidence |
|---|---|---|---|
| BUG-SEC-1 | Critical (prod) | Identity headers trusted in production (see section 4). | `it.fails` test in place |
| SEC-INFO-1 | Major | BUG-PIPE-1 leaks the full SQL statement and bind parameters to Submitters via `failureReason`. | pinned by "current behaviour" test |
| GAP-SEC-2 | Low | Cookie-authenticated non-GET with **no** `Origin` header passes the middleware CSRF check (relies on `SameSite=Lax`, which browsers do enforce). | `security-roles.spec.ts` GAP-SEC-2 |
| GAP-SEC-3 | Low (dev only) | Login CSRF: `POST /api/auth/dev-login` is never origin-checked when no session exists. Route is 404 in production. | `security-roles.spec.ts` GAP-SEC-3 |
| AUDIT-1 | High/Critical (dev deps) | `npm audit`: vitest 3 / tinypool (critical RCE gadget, path traversal - fix `vitest@5`), eslint-config-next chain (`braces`/`micromatch` ReDoS - fix is a downgrade to 14.2.35; wait for 15.x), tailwindcss 3 chain (`chokidar`/`fast-glob`, no fix), `sharp` (fix available), `source-map-js` (fix available). None are runtime server dependencies. | CI now runs `npm audit --audit-level=high` (non-blocking) |
| PASS | - | Full role matrix (14 routes x 4 roles) correct: anon 401, Submitter 403 on ledger/verify/PRIVATE, Reviewer 403 on upload/verify, Admin all. 401 sub-codes correct; `x-role` alias works. | `security-roles.spec.ts` role matrix |
| PASS | - | Employer scoping: other employer's batch/findings/records/reports/rejected.csv -> **404** (no existence leak), list filters cannot widen scope, no audit row for denied PII download. | "employer scoping" block |
| PASS | - | PRIVATE findings hidden from Submitters in list, every page, ruleId filter and facets; visible to Reviewer/Admin. | "PRIVATE findings" block |
| PASS | - | Dev cookie: tampered role, bad JSON, bad base64, Submitter without employer, array/null payloads all rejected; cookie `HttpOnly; SameSite=Lax; Path=/`; cross-origin POST with cookie -> 403; prod disables bridge and dev-login (404). | "dev session cookie + middleware" + "dev-login" blocks |
| PASS | - | Path traversal on report names (`..`, encoded, NUL, case, look-alikes) -> 400; employerId/sourceSystem validated; filenames with `..\` or 1,000 chars stored only as metadata, lake path built from ids. | adversarial + security specs |
| PASS | - | CSV formula injection (`=`, `+`, `@`, tab, `-2+3+cmd`) neutralised with `'` in `rejected.csv`; numeric negatives left reloadable; HTML in name cells renders as text in the UI (no element injected, no dialog). | adversarial spec + `e2e:qa` |
| PASS | - | Open redirect: `/login` has no `next` parameter (always `/`). | code inspection |
| PASS | - | No raw SIN anywhere except `raw/original.csv` and `rejected.csv` (section 2, AC6). | leak sweep |

## 6. Accessibility scan (axe-core 4.14, WCAG 2.x A/AA + best-practice, Chrome)

Totals over 15 page states: **0 critical, 32 serious, 22 moderate, 3 minor** (raw data: `docs/qa/axe-summary.json`). The ux 8.1 CI gate ("zero serious/critical") is **not met yet**; the serious count comes from four root causes.

| Page state | critical | serious | moderate | minor | Main rules |
|---|---|---|---|---|---|
| Dashboard (Submitter) | 0 | 2 | 1 | 0 | color-contrast(4), label-content-name-mismatch(1), region |
| Upload | 0 | 3 | 2 | 0 | color-contrast(4), label-content-name-mismatch(2), **nested-interactive** (dropzone `.border-2` contains the browse button), landmark-unique, region |
| Batch overview | 0 | 2 | 2 | 0 | color-contrast(7), label mismatch, landmark-unique, region |
| Findings (dialog open) | 0 | 1 | 0 | 0 | color-contrast(7) |
| Findings (by severity) | 0 | 3 | 2 | 1 | **aria-conditional-attr(41 rows)**, color-contrast(7), label mismatch(2), empty-table-header, landmark-unique, region |
| Findings (by row) | 0 | 2 | 2 | 0 | color-contrast(7), label mismatch, landmark-unique, region |
| Records | 0 | 3 | 2 | 1 | **aria-conditional-attr(100 rows)**, color-contrast(7), label mismatch(2), empty-table-header, landmark-unique, region |
| Reports | 0 | 2 | 2 | 0 | color-contrast(11), label mismatch, landmark-unique, region |
| Execution report view | 0 | 2 | 2 | 0 | color-contrast(8), label mismatch, landmark-unique, region |
| Batches list | 0 | 2 | 2 | 1 | color-contrast(2), label mismatch(2), empty-table-header, landmark-unique, region |
| 404 page | 0 | 2 | 2 | 0 | **aria-prohibited-attr** (`.divide-y`), color-contrast(2), label mismatch, **page-has-heading-one**, region |
| 403 page | 0 | 2 | 1 | 0 | color-contrast(2), label mismatch, region |
| Ledger explorer | 0 | 2 | 2 | 0 | color-contrast(5), label mismatch(2), landmark-unique, region |
| Ledger (drawer open) | 0 | 3 | 0 | 0 | color-contrast(5), label mismatch(2), **nested-interactive** (`<summary>`) |
| Login | 0 | 1 | 0 | 0 | color-contrast(8) |

Root causes and fixes: (1) **color-contrast** - the `text-ink-faint` token (`#upload-help`, section eyebrow labels `.pb-1.uppercase.tracking-wide`, footer) fails 4.5:1 on `bg-background`; darken the token. (2) **label-content-name-mismatch** - icon/text controls whose `aria-label` does not include the visible text (`a[aria-label="HOOPP Events Ledger home"]`, pagination "Previous page"/"Next entry (Alt+Right)", dropzone `.border-2`); make the visible text part of the name. (3) **aria-conditional-attr** - BUG-UI-4. (4) **region / landmark-unique** - the environment chip (`.text-[11px]`) sits outside landmarks and two `nav[aria-label="Breadcrumb"]` render on tabbed pages. Manual checks that **passed**: one `<h1>` per page, landmarks present, skip link first and visible on focus, 2 px focus ring + box-shadow on every focused control, DataTable roving tabindex with ArrowUp/Down/Home/End/Enter, `aria-sort` on sortable headers, `<caption>` + labelled `tabindex=0` scroll region, dialog traps focus, Esc closes dialog/drawer, `aria-live="polite"`/`aria-atomic` region on batch pages, `[aria-live]`/`role=status` present on the ledger page, no horizontal overflow at 768 px.

## 7. Performance (dev laptop, PGlite in-memory, `npm run test:perf`)

| Scenario | Rows | Bytes | ingest | parse+validate+ledger | **Total to VALIDATED** | Heap delta | RSS |
|---|---|---|---|---|---|---|---|
| clean-100 | 100 | 10.8 kB | 71 ms | 454 ms | **0.53 s** | +5 MB | 400 MB |
| clean-1000 | 1,000 | 105 kB | 44 ms | 1,862 ms | **1.9 s** | -2 MB | 401 MB |
| clean-5000 | 5,000 | 525 kB | 50 ms | 7,615 ms | **7.7 s** (budget 60 s) | +22 MB | 444 MB |
| mixed-5000 (40 % rejected -> 2,000 member ledger entries) | 5,000 | 524 kB | 34 ms | 14,029 ms | **14.1 s** | -4 MB | 453 MB |
| `verify()` over 2,008 entries | - | - | - | - | **3.06 s** (~650 entries/s) | | |
| `appendMany(600)` single tx | - | - | - | - | 1.35-1.49 s (**~400-450 entries/s**; architecture target >= 500/s - PGlite/WASM) | | |
| 1,000 rows through the HTTP route (`?wait=true`, in-process) | 1,000 | | | | 2.0-2.6 s | | |

Memory is flat across runs (no growth after GC); the whole file is buffered once (`file.arrayBuffer()`), acceptable at the 20 MB cap.

## 8. New tests and wiring

| Area | File | Tests |
|---|---|---|
| Rule conformance boundaries (I1-I10, I32, I55, B187x6, I42, I50/I51 structure, engine composition, render) | `tests/qa/rules-boundaries.spec.ts` | 135 (2 `it.fails`) |
| Adversarial uploads + state machine | `tests/qa/adversarial-upload.spec.ts` | 32 (2 `it.fails`) |
| Ledger integrity (concurrency, verify edges, atomicity, immutability) | `tests/qa/ledger-integrity.spec.ts` | 11 (1 `it.fails`) |
| Security (role matrix, scoping, PRIVATE, cookie/middleware/CSRF, dev-login, traversal, PII sweep) | `tests/qa/security-roles.spec.ts` | 38 (1 `it.fails`) |
| Shared helper (route wrappers, CSV builders, envelope + legal-state assertions) | `tests/helpers/qa-api.ts` | - |
| Performance smoke (opt-in) | `tests/perf/pipeline-perf.spec.ts` + `vitest.perf.config.ts` | 5 |
| Browser E2E + axe | `tests/e2e/phase1-qa.mjs` | 42 checks + 15 axe scans; writes `docs/qa/e2e-qa-results.json`, `docs/qa/axe-summary.json` |
| **Total vitest** | | **+216 (193 -> 409)**; all deterministic (frozen clock/ids via `createTestContext`, injected execution dates) |

Scripts: `npm run test:qa`, `npm run test:perf`, `npm run e2e:qa`. `vitest.config.ts` excludes `tests/perf/**` and `tests/e2e/**` from the default run. Dev dependency added: `axe-core@4.14`. CI (`.github/workflows/ci.yml`): `test:coverage` already runs `tests/qa/**`; added `npm audit --audit-level=high` (non-blocking until advisories are resolved) and an `e2e` job (build, `next start`, `e2e:phase1`, `e2e:qa`, artifacts) marked `continue-on-error` for its first runs.

## 9. Release recommendation: **GO** (Phase 1, dev/demo scope) - updated after the fix pass (section 11)

All blocking items below (1-4) and the critical audit advisory (6) were fixed in the fix pass; every gate is green (section 11). Remaining before promotion beyond local/demo: item 5 (verify on real Postgres) and the EntraId provider for production auth. Original assessment follows.

Functionally every AC1-AC7 holds on the PGlite path, rule logic conforms to the spec (deviations are deliberate and documented), the ledger is sound under concurrency and tampering, and no raw SIN leaks anywhere. Before this foundation is promoted to a shared/dev environment or Phase 2 builds on it, fix:

1. **BUG-SEC-1** - strip/refuse `x-user-*` headers outside the dev bridge (blocking for any non-local deployment).
2. **BUG-PIPE-1/2** - NUL/UTF-16 handling + never persist raw driver errors (`failureReason`); add FAILED-batch dedup exclusion (BUG-PIPE-3).
3. **BUG-PARSE-1** - `record_delimiter` list (false file rejections).
4. **BUG-UI-4 + color-contrast + label mismatch** - to reach the ux 8.1 "zero serious" gate; then flip the `e2e` CI job to blocking.
5. Verify AC1/AC5 on real Postgres (Docker) once available: GRANT-based UPDATE rejection and `docker compose up`.
6. Resolve or formally accept the dev-dependency `npm audit` items (vitest 5 upgrade is the critical one).

Open spec questions for HOOPP: LastName/FirstName mandatory (I1), case sensitivity of header labels and EventType (I51/I9), I55 with blank Low, I7 CY/PY message-id split, trailing-comma strictness (I50/I51).

## 10. Commits

Branch `main`, not pushed. Base: `94fd2f8` (Web Developer Phase 1 complete).

| Hash | Commit |
|---|---|
| `89683bb` | test(qa): rule conformance boundary probes for L0/L1/I42; fix stateful regex in hasUnresolvedPlaceholders |
| `31bb4d5` | test(qa): adversarial POST /api/batches inputs and state-machine legality |
| `77138e5` | test(qa): ledger integrity under concurrency, verify edge ranges, atomic append, immutability triggers |
| `75211bc` | test(qa): security role matrix, employer scoping, PRIVATE visibility, dev-auth bridge/CSRF, traversal, raw-SIN leak sweep |
| `8773fad` | test(perf): opt-in pipeline performance smoke; exclude perf/e2e from default vitest run |
| `beba1a6` | test(e2e): Phase-1 QA browser suite with axe-core scans |
| `a299e80` | ci: surface npm audit (non-blocking) and add e2e job |
| `6257f3d` | docs(qa): Phase 1 QA report + E2E/axe artifacts |
| `96e7eda` | docs(qa): record commit hashes |

## 11. Fix pass (2026-10-09)

Every bug from section 4 was fixed on `main` (not pushed). `it.fails` pins were converted to normal passing tests; the e2e "known gaps" are now blocking checks.

| # | Fix | Files | Test | Status |
|---|---|---|---|---|
| BUG-SEC-1 | `middleware.ts` deletes every inbound `x-user-id`/`x-user-role`/`x-role`/`x-employer-id` on every request (dev and prod) and only then bridges the dev cookie (non-production). `HeaderAuthProvider.getSession()` returns `null` when `NODE_ENV=production` (defence in depth if the matcher were bypassed). Documented in architecture 13.1 and README (curl now logs in via `/api/auth/dev-login` cookie). | `src/middleware.ts`, `src/lib/auth/identity-headers.ts`, `src/lib/auth/session.ts` | `security-roles.spec.ts`: "BUG-SEC-1 (fixed)" (prod: stripped + provider null + route 401), "dev: client-supplied ... stripped" x2, "non-production: provider accepts"; live probe: forged headers -> 401, submitter cookie + forged Admin header -> 403 | FIXED |
| BUG-PIPE-1 | `detectEncodingProblem()` (UTF-16 LE/BE BOM, BOM-less UTF-16 by NUL pattern, any NUL byte) short-circuits `parseEventsCsv`; I51 fires `calculated.reason=UNSUPPORTED_ENCODING`, `detected` in {UTF16_LE, UTF16_BE, NUL_BYTES} (spec has no encoding rule; choice recorded in architecture 7.9.1). | `src/lib/events/decode.ts`, `parse.ts`, `src/lib/rules/types.ts`, `l0/I51.ts`, `pipeline/run.ts` | `adversarial-upload.spec.ts` "BUG-PIPE-1 (fixed)" (4 variants -> FILE_REJECTED, history RECEIVED,FILE_REJECTED, no failureReason); `rules-boundaries.spec.ts` UTF-16/NUL probe | FIXED |
| BUG-PIPE-2 | NUL in a data cell is the same L0 path -> 200 FILE_REJECTED, no orphan, FILE_REJECTED never dedups so the bytes can be re-uploaded. | as above | "BUG-PIPE-2 (fixed)" | FIXED |
| SEC-INFO-1 | `runBatch` catch: `failureRef = ctx.newId()`, full error logged with the ref, `failureReason = sanitizeFailureReason()` (only `PipelineError` messages pass through; control chars stripped; 500 chars); FAILED transition is best-effort and never rethrows. | `src/lib/pipeline/run.ts` | "SEC-INFO-1 (fixed)" (injected driver-style error: API shows `Processing failed unexpectedly. Reference <uuid>`, no SQL/params; log has the detail) | FIXED |
| BUG-PIPE-3 | Architecture 11 lists `POST /api/batches/{id}/retry` (Admin), so that was implemented instead of changing dedup (the partial unique index would need a migration): FAILED -> RECEIVED on the same batchId, partial `events_records`/`validation_findings` dropped, counters reset, audit `BATCH_RETRY`, `?wait=true` runs inline; bronze/silver artifacts from the failed attempt are reused (write-once lake). Batches menu "Retry processing" calls it. | `src/app/api/batches/[batchId]/retry/route.ts`, `run.ts` (`putOnce`), `batches-table-live.tsx` | "BUG-PIPE-3 (fixed)" (role matrix 401/403/404/400/409, FAILED -> VALIDATED, history RECEIVED,PARSED,FAILED,RECEIVED,PARSED,VALIDATED) | FIXED |
| BUG-PARSE-1 | `record_delimiter: [CRLF, LF, CR]`. | `src/lib/events/parse.ts` | `rules-boundaries.spec.ts` "BUG-PARSE-1 (fixed)" (CRLF/LF/CR in any order -> lines 2,3,4) | FIXED |
| BUG-PARSE-2 | csv-parse `info.lines` is the record END line and counts CR and LF of a quoted CRLF separately; `parseEventsCsv` recovers the physical start line by subtracting newlines inside the record and the cumulative CR excess of earlier records. | `src/lib/events/parse.ts` | "BUG-PARSE-2 (fixed)" (lines 2,4 / 2,5,7 / LF variant) | FIXED |
| BUG-API-1 | zod `.refine(isValidIsoDate)` (real calendar date, 1900-2999). | `src/app/api/batches/route.ts`, `src/lib/events/fields.ts` | `adversarial-upload.spec.ts` "BUG-API-1 (fixed)" (5 impossible dates -> 400, 2024-02-29 accepted) | FIXED |
| GAP-LEDGER-1 | `fromSeq > toSeq` -> 400 VALIDATION_ERROR; `verifyLedger` returns `ledgerSeq: null` and appends nothing when `checked === 0`. | `src/app/api/ledger/verify/route.ts`, `src/lib/queries/ledger.ts` | `ledger-integrity.spec.ts` "GAP-LEDGER-1 (fixed)" (reversed 400; empty range/unknown stream -> no ChainAnchorPublished; real range still ledgered) | FIXED |
| BUG-UI-4 + a11y serious set | `aria-expanded` only on the expand button; `--ink-faint` 60% -> 45% (dark 48% -> 60%); pagination/drawer buttons use visible text; home link `aria-label` only when collapsed; dropzone follows the react-dropzone button-inside pattern (`noClick`/`noKeyboard`, root is not a button); payload copy/download moved out of `<summary>`; top bar is a `<header>` banner (env chip inside a landmark); nav labels `Breadcrumb` / `Page breadcrumb` / `Sidebar navigation`; disabled report cards use `bg-surface` instead of `opacity-70`; not-found pages render `h1`; sr-only text for the Expand/Actions header cells. | `globals.css`, `data-table.tsx`, `pagination.tsx`, `entry-drawer.tsx`, `sidebar-nav.tsx`, `top-bar.tsx`, `page-header.tsx`, `file-dropzone.tsx`, `ledger-entry-card.tsx`, `empty-state.tsx`, `reports/page.tsx` | `e2e:qa` axe: **0 critical / 0 serious / 0 moderate / 0 minor** over 15 page states (was 0/32/22/3); new blocking check "axe: zero serious/critical violations" | FIXED |
| BUG-UI-2 | A segment cannot catch its own layout, and any `loading.tsx` above the thrower flushes a 200 first. The dashboard and the batches list (with their `loading.tsx`) moved into route groups `(dashboard)` and `batches/(list)`, so the `[batchId]` layout renders in the shell; its `notFound()` is caught by the new `batches/not-found.tsx` (batch copy) with a real 404. | `src/app/(app)/(dashboard)/*`, `batches/(list)/*`, `batches/not-found.tsx`, `_lib.ts` | `e2e:qa` "BUG-UI-2a/2b (fixed)" + "malformed batch id -> 404"; fetch probe: unknown uuid 404, `not-a-uuid` 404, both with batch copy | FIXED |
| BUG-UI-3 | `ConfirmDialog.returnFocusTo` -> `onCloseAutoFocus` focuses the trigger; `RejectedCsvButton` passes its ref. | `confirm-dialog.tsx`, `rejected-csv-button.tsx` | `e2e:qa` "BUG-UI-3 (fixed)" | FIXED |
| GAP-D12 | `useIsDesktop()` (matchMedia >= 1024 px). Upload: dropzone + submit disabled and an info Alert "Use a desktop browser (>= 1024 px) for this action"; Verify button disabled with the same tooltip. Navigation untouched. | `src/lib/ui/use-is-desktop.ts`, `upload-form.tsx`, `integrity-banner.tsx` | `e2e:qa` "D12 (fixed)" at 768 px | FIXED |
| COS-1 | `DataTable.rowTestId`; ledger rows carry `data-testid="ledger-row-{seq}"`. | `data-table.tsx`, `ledger-table.tsx` | `e2e:qa` "COS-1 (fixed)" | FIXED |
| COS-2 | `file.size === 0` -> 400 `EMPTY_FILE`, no batch. Whitespace-only files still become FILE_REJECTED (legal). | `src/app/api/batches/route.ts` | "COS-2 (fixed)" | FIXED |
| COS-3 | Pre-flight row/line counter treats CRLF, LF and CR as terminators. | `src/app/api/batches/route.ts` | covered by "LF-only and CR-only files parse like CRLF" + limits test | FIXED |
| AUDIT-1 | `vitest`/`@vitest/coverage-v8` 3.2.7 -> 5.0.3 (`@types/node` 22 to satisfy the peer; `vitest.config.ts` uses `oxc.jsx.runtime` for Vite 8), `next` 15.5.25 -> 15.5.27, `sharp`/`source-map-js` patched via `npm audit fix`. 21 -> 14 advisories, **0 critical** (was 2). Remaining 7 high are all `braces`/`micromatch`/`fast-glob`/`chokidar` under `eslint-config-next` and `tailwindcss 3`: no fixed upstream version exists yet (`braces` latest 3.0.3 is the flagged one; npm offers only a downgrade of `eslint-config-next` to 14.x). 7 moderate: `esbuild`/`@esbuild-kit` under `drizzle-kit` (fix = downgrade to 0.18), `postcss-selector-parser` under tailwind 3. All dev/build tooling, none at runtime. `npm audit --audit-level=high` stays non-blocking in CI with that note. | `package.json`, `package-lock.json`, `vitest.config.ts` | `npm test` 413 passed, `test:coverage`, `test:perf` 5/5 on vitest 5 | PARTIAL (no upstream fix) |

### Gates after the fix pass

| Gate | Result |
|---|---|
| `npm run typecheck` / `lint` / `lint:pii` | pass / 0 warnings / ok |
| `npm test` | 43 files, **413 passed, 1 skipped** (Postgres-only GRANT test), 0 `it.fails` left |
| `npm run test:coverage` (vitest 5 v8 remapping - not comparable with section 1) | lines 87.45 % / branches 76.06 % / functions 80.20 %; `src/lib/rules/**` 98.9 % lines; pipeline/events/ledger modules 97-100 % |
| `npm run build` | Compiled successfully (27 s); shared First Load JS 103 kB; `/ledger` 200 kB, `/batches` 198 kB, `/upload` 171 kB; middleware 34.1 kB |
| `npm run e2e:phase1` | 31/31 PASS |
| `npm run e2e:qa` | **48 PASS, 0 FAIL, 0 known gaps, 0 notes**; axe 0/0/0/0 across 15 page states |
| `npm run test:perf` | 5/5 PASS |
| CI | `e2e` job is now blocking (`continue-on-error` removed); `npm audit` stays advisory |

Design notes: header identities over HTTP can now only originate from the middleware (cookie bridge), so the README curl example logs in through `/api/auth/dev-login`; in-process tests keep passing headers directly. Admin retry reuses the write-once bronze/silver artifacts of the failed attempt (record ids inside those files may differ from the rebuilt DB rows) - acceptable for Phase 1, flagged for the lake-cleanup story. Not done: AC1/AC5 on real Postgres (no Docker on this machine); `EntraIdAuthProvider` remains Phase 4.
