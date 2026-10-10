# Phase 2 QA Report - HOOPP Events Validation Ledger

Independent QA pass against `docs/architecture.md` section 17 "Phase 2 - L2 rules + mock Ariel" (AC1-AC5), the v15.1 validation spec (`docs/reference/hoopp-ch7-validations-v15.1.txt`) and the Phase 1 report (`docs/qa/phase1-report.md`, must not regress). Target commit **`3ebad53`** (no developer report existed - section 2 is the reconstructed inventory). Executed 2026-10-09 on Windows / Node 22.23.2 / PGlite. Every claim cites a test name, command or artifact.

## 1. Gate results + coverage

| Gate | Result at `3ebad53` | After QA additions |
|---|---|---|
| `npm run typecheck` | pass (0 errors) | pass |
| `npm run lint` | pass (0 warnings) | pass |
| `npm run lint:pii` | ok | ok |
| `npm run test:coverage` | 85 files, **576 passed / 1 skipped** | 88 files, **635 passed / 1 skipped / 1 expected-fail** (+59) |
| Coverage `src/lib/**` (lines / branches / functions) | 91.88 % / 82.79 % / 87.58 % | see section 10 |
| **`src/lib/rules/**` lines / branches** (AC1 gate >= 95 % lines) | **98.08 % / 93.75 %** (`rules/events/l2` 99.78 % / 96.04 %; `rules/lib` 94.95 % / 90.62 % - `carve-out.ts` 83.3 % lines, 55 % branches: the pairwise de-overlap branches were untested) | `carve-out.ts` branches now exercised by `tests/qa/l2-boundaries.spec.ts` |
| `src/lib/derivation` / `src/lib/ariel` / `src/lib/pipeline` lines | 97.22 % / 95.21 % / 97.65 % | unchanged |
| `npm run build` | Compiled successfully (7.5 s); shared First Load JS 103 kB; `/ledger` 200 kB, `/batches` 198 kB, `/upload` 171 kB; middleware 34.1 kB | unchanged (no `src/` change except one line, section 5) |
| `db:migrate` from a wiped `.data/` + `db:seed` | `[db:migrate] done` (0000-0002 applied), `[db:seed] members=68 employments=70 employers=3 rateRows=60` | - |
| `npm run e2e:phase1` (against `npm run dev`) | **27 PASS then ERROR** at check 28 (strict-mode violation: two `verify-button` elements) - pre-existing, see BUG-E2E-1; the developer's own run (`.data/e2e-phase1-p2.log`) failed identically | **31/31 PASS** after the locator fix |
| `npm run e2e:qa` | 50 PASS then the same ERROR; axe **0/0/0/0 over 13 page states** | **PASS** incl. two new Phase 2 checks (section 5, BUG-UI-P2-1); axe 0/0/0/0 over 15 page states |
| `npm run test:perf` (Phase 1 scenarios on Phase 2 code) + new `tests/perf/phase2-perf.spec.ts` | 5/5 + 3/3 PASS, numbers in section 9 | - |

Notes. (1) `next start` cannot host the E2E suites: production mode disables the dev login by design (`/login` -> 404, Phase 1 BUG-SEC-1 fix), so both suites were run against `npm run dev` as their headers say. (2) Under `next start` with the `.env.example` default `LOG_PRETTY=true`, pino's pretty transport crashes at boot (`Directory import ... pino-pretty is not supported ... uncaughtException: the worker has exited`); the server keeps serving (`/api/health` 200) but logs are lost - GAP-ENV-1. (3) The skipped test is the Postgres-only GRANT test from Phase 1.

## 2. Inventory (reconstructed - no developer report)

### 2.1 L2 rules shipped (41 = 40 enabled + B181 disabled) in registry order (architecture 7.9.4)

| # | Rule | Message ID(s) | Severity | Visibility | Default | Tool | Override reasons | Section-18 note in code |
|---|---|---|---|---|---|---|---|---|
| 1 | B2 | 1418 | CME | PUBLIC | on | DataImport | - | |
| 2 | B204 | 6279 | CME | PUBLIC | on | StandardValidationModule | - | |
| 3 | B224 | 3001 | CME | PUBLIC | on | StandardValidationModule | - | |
| 4 | B5 | 5728 | CME | PUBLIC | on | DataImport | - | |
| 5 | B223 | 2953 | CME | PUBLIC | on | DataImport | - | Q23 |
| 6 | B109 | 7476 | CME | PUBLIC | on | DataImport | - | |
| 7 | I42 | 8106 | CME | PUBLIC | on (RETFIN via `I42_APPLY_TO_RETFIN`) | DataImport | - | Q5 |
| 8 | B112 | 1616 (TERFIN) / 8112 (DECFIN) | CME | PUBLIC | on | DataImport | - | |
| 9 | B113 | 9075 | CME | PUBLIC | on | DataImport | - | |
| 10 | B139 | 2492 | WARNING | PUBLIC | on | DataImport | 1 | Q13 |
| 11 | B192a | 405 | CME | PUBLIC | on | DataImport | - | |
| 12 | B192b | 7166 | CME | PUBLIC | on | DataImport | - | |
| 13 | B22 | 5604 | CME | PUBLIC | on | CustomDLL | - | |
| 14 | B19 | 9815 | CME | PUBLIC | on | CustomDLL | - | |
| 15 | B19b | 2955 | CME | PUBLIC | on | DataImport | - | |
| 16 | B31 | 7309 | **WARNING** (spec: CME) | PUBLIC | on | DataImport | 1 | Q6 |
| 17 | B33 | 5001 | WARNING | PUBLIC | on | CustomDLL | 1 | Q7 |
| 18 | B37 | 3029 | CME | PUBLIC | on | CustomDLL | - | |
| 19 | B38 | 480 | WARNING | PUBLIC | on | CustomDLL | 2 | |
| 20 | B184a | 66 | CME | PUBLIC | on | CustomDLL | - | |
| 21 | B184b | 3002 | CME | PUBLIC | on | CustomDLL | - | |
| 22 | B184c | 7854 | CME | PUBLIC | on | CustomDLL | - | **Q25 (undocumented)** |
| 23 | B185 | 3506 | CME | PUBLIC | on | CustomDLL | - | |
| 24 | B186a | 573 | CME | PUBLIC | on | CustomDLL | - | Q10 |
| 25 | B186b | 3466 | CME | PUBLIC | on | CustomDLL | - | Q10 |
| 26 | B186c | 9829 | CME | PUBLIC | on | CustomDLL | - | Q10 |
| 27 | B53a | 2160 | CME | PUBLIC | on | CustomDLL | - | |
| 28 | B53b | 7375 (situation 1) / 8795 (situations 2-3) | CME | PUBLIC | on | CustomDLL | - | Q8, Q22 |
| 29 | B181 | 6700 | CME | PUBLIC | **OFF** (`enabled.B181=false`) | DataImport | - | Q21 |
| 30 | B182 | 9810 | INFORMATION | PRIVATE | on | DataImport | - | |
| 31 | B40 | 1238 | WARNING | PUBLIC | on | CustomDLL | 7 | **Q27 (undocumented)** |
| 32 | B41 | 6065 | INFORMATION | PRIVATE | on | CustomDLL | - | Q27 |
| 33 | B43 | 5613 | WARNING | PUBLIC | on | CustomDLL | 6 | Q27 |
| 34 | B44 | 1646 | INFORMATION | PRIVATE | on | CustomDLL | - | Q27 |
| 35 | B47 | 2990 | WARNING | PUBLIC | on | DataImport | 1 | |
| 36 | B214 | 6012 | WARNING | PUBLIC | on | DataImport | 2 | |
| 37 | B207 | 2153 | CME | PUBLIC | on | DataImport | - | |
| 38 | B203 | 619 | CME | PUBLIC | on | StandardValidationModule | - | |
| 39 | B205 | 1070 | CME | PUBLIC | on | StandardValidationModule | - | |
| 40 | B206 | 619 | CME | PUBLIC | on | StandardValidationModule | - | Q17 |
| 41 | B202 | 6908 | CME | PUBLIC | on | StandardValidationModule | - | |

Invariants asserted by `tests/qa/l2-boundaries.spec.ts` "catalogue invariants": exact 7.9.4 order; WARNING <=> non-empty `overrideReasons`; INFORMATION <=> PRIVATE; only B181 disabled by default; only I42 does not require Ariel. Warnings = 8 (B139, B31, B33, B38, B40, B43, B47, B214); PRIVATE = B41, B44, B182 - matches 7.9.5 with the B31 footnote. Tolerance keys exposed to Admin (`TOLERANCE_KEYS`, 21): B31.windowStart, B37.tolerance1Weeks/tolerance2Dollars, B38.toleranceWeeks, B40.pct, B41.pct, B43.amount, B44.amount, B47.min/max, B53a.pa, B53b.pa, B184a/b/c.weeks, B185.weeks, B186a/b.weeks, B186c.factor, B214.weeks, **B214.minLeaveDays** (new, not in architecture 7.7).

### 2.2 API routes added / changed since `94496ff` (`git diff 94496ff..3ebad53 --stat -- src/app/api`)

| Route | Role | Notes |
|---|---|---|
| `POST /api/findings/{findingId}/override` **new** | Reviewer, Admin; EmployerSubmitter only with `ALLOW_SUBMITTER_OVERRIDE` and own employer | body `{ reason, note? }`; 200 `{ finding, rowOutcome, heldRemaining, ledgerSeq }`; 422 `REASON_NOT_ALLOWED` / `NOTE_REQUIRED` ("Other" reasons) / `NOT_OVERRIDABLE` / `BATCH_NOT_VALIDATED`; 409 `ALREADY_OVERRIDDEN`; 404 for other employers (no existence leak) |
| `POST /api/batches/{batchId}/findings/{findingId}/override` **new** | same | batch-scoped alias; 404 when the finding belongs to another batch |
| `POST /api/batches/{batchId}/findings/override` **new** (bulk) | same | body `{ findingIds[1..200], reason, note? }`; **per-item, not atomic** (docs/ux-design.md 5.4.2: "each override is a separate API call and ledger entry"); 200 all ok, **207** partial, 422 `NO_OVERRIDE_APPLIED` when none applied; response `{ results[], heldRemaining }` |
| `GET /api/batches/{batchId}/findings` changed | any | new filter `?override=pending|done` |
| `GET /api/batches/{batchId}` changed | any | `counts.held` added; `rulesConfigHash`, `arielSnapshotHash`, `arielAdapter` added; `reports[]` now lists `summary-of-validations.csv`, and for Reviewer/Admin only `summary-of-validations.private.csv`, `ariel-snapshot.ndjson`, `rules-config.json` |
| `GET /api/batches/{batchId}/reports/{name}` changed | any / HOOPP-only for the three PRIVATE_REPORTS (403 for Submitter) | 4 new report names |
| `GET /api/batches/{batchId}/records` changed | any | `?accepted=held` now means `outcome = HELD`; `outcome` values `ACCEPTED | REJECTED | HELD | PENDING` |
| `GET /api/rules` changed | any (no session) | shape changed: `{ items: RuleCatalogueItem[], config: { hash, enabled, tolerances, nhh, nhhEmployers, disabled } }`; items gained `messageIds[]`, `section`, `enabledByDefault`, `overridden`, `specNote`, `tolerances[]`; **`implemented` removed**; `messageId` for multi-ID rules is now `"1616 / 8112"` instead of `"multiple"` |
| `PATCH /api/rules/{ruleId}` **new** | Admin | `{ enabled?, tolerances?, reason }` -> `{ rule, config, changes[], ledgerSeq }`; 404 unknown rule, 422 `UNKNOWN_TOLERANCE` / `INVALID_TOLERANCE`, 400 nothing to change; ledgered `RulesConfigChanged` on stream `system`, audit `RULES_CONFIG_CHANGED`; no-op change -> `changes: [], ledgerSeq: null` |
| `DELETE /api/rules/{ruleId}?reason=` **new** | Admin | drops every override for the rule (back to file defaults); ledgered |
| `GET /api/rules/history` **new** | Reviewer, Admin | last 100 `RulesConfigChanged` ledger entries (desc) |
| `GET /api/ariel/members?employerId=&q=` **new** | Reviewer, Admin | masked list (`sinPseudo`, `sinMasked`, names, DOB, status, scenario, employments summary, `duplicateSin`) |
| `GET /api/ariel/members/{sinPseudo}` **new** | Reviewer, Admin | `{ adapter, members[] }` (several members share a pseudonym for B204); 400 bad pseudonym, 404 unknown |
| `GET /api/ariel/rates` **new** | any session | `{ adapter, rows[] }` every row `placeholder: true` |
| `POST /api/ariel/reseed` **new** | Admin, non-production (404 in prod) | truncate + reload `tests/fixtures/ariel-seed.json` |

Architecture 11 lists `GET/PUT /api/config/rules` for config; the implementation chose `PATCH/DELETE /api/rules/{ruleId}` + `/api/rules/history` instead (functionally equivalent; the doc should be updated).

### 2.3 Schema (`drizzle/0002_phase2.sql`), env, scripts, lake, ledger

- New table `rules_config_overrides (rule_id, key, value jsonb, updated_by, updated_at)` PK (rule_id, key). `batches` + `held_total`, `rules_config_hash`, `ariel_snapshot_hash`, `ariel_adapter`. `events_records` + `outcome` (ACCEPTED/REJECTED/HELD; `accepted` kept: null for HELD). `validation_findings` + `override_note`, `override_ledger_seq`. `ariel_mock.members` + `scenario`, `status`/`status_effective_date` now nullable (B203 fixtures). `ariel_mock.rate_tables` + `placeholder`.
- `.env.example`: no new variables in this commit (`ALLOW_SUBMITTER_OVERRIDE`, `I42_APPLY_TO_RETFIN`, `RULES_DISABLED` already existed). `package.json`: no new scripts (`db:seed` existed; `scripts/golden-dump.ts` added as a dev helper).
- Lake: `silver/ariel-snapshot.ndjson` (meta line without `batchId` so the hash is a pure function of the data; member lines keyed by `sinPseudo`, SIN never present), `silver/rules-config.json` (effective config + hash), `gold/summary-of-validations.csv` and `.private.csv` (regenerated after every override). Snapshot is write-once: Admin retry reuses it.
- Ledger: `MemberRecordValidated` for ACCEPTED rows (payload: findings summaries sorted, `findingsHash`, `overrides[]`, `rulesConfigHash`, `arielSnapshotHash`), `MemberRecordRejected` for REJECTED rows, `WarningOverridden` per override (+ `MemberRecordValidated` when the row becomes ACCEPTED), `RulesConfigChanged` on `system`. HELD rows are ledgered only once accepted.
- Seed: 18 architecture members (M1-M18, Luhn-recomputed SINs 9000000xx) + M6b + 19 golden "G" members + 30 single-rule "L" members = 68. Names of M16-M18 differ from architecture 4.6 (QUINN/ROSS/SINGH vs PATEL/QUINN/ROSS) - cosmetic.
- **Not delivered in `3ebad53` although in the section 17 scope**: warning-override UI (OverrideDrawer, HELD rows tab), Mock Ariel browser page `/ariel`, Admin rules page `/admin/rules`. No file under `src/app/(app)` or `src/components` changed (GAP-SCOPE-1). AC1-AC5 do not require them.

## 3. AC1-AC5 verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1 all 41 L2 rules unit-tested per section 15 (incl. yearScope and multi-ID); coverage >= 95 % on `src/lib/rules` | **PASS** | `tests/rules/<id>.spec.ts` exists for every L2 rule (meta-test `tests/rules/registry.spec.ts`); yearScope cases present for every twice-executed rule (B22, B53a/b, B184a/b/c, B185, B186a/b/c, B214, B19/B19b, B40-B47, B192a); multi-ID cases for B112 (1616/8112) and B53b (7375/8795). Coverage `src/lib/rules` **98.08 % lines / 93.75 % branches**. Gap closed by QA: `carve-out.ts` de-overlap branches (55 % -> exercised), tolerance edges at the exact cent/week (section 4). +42 QA probes in `tests/qa/l2-boundaries.spec.ts`. |
| AC2 golden `mixed-100-rows` byte-identical `findings.ndjson` on two consecutive runs AND matches the checked-in expectation; every L2 message ID appears >= 1 | **PASS** | `tests/integration/phase2.spec.ts` "AC2: determinism" (second run in a fresh context, same `arielSnapshotHash`/`rulesConfigHash`; happy-* goldens too). `tests/golden/mixed-100-rows/expected-message-ids.json` lists 40 L2 IDs + 8106 (I42) and `expected-findings.ndjson` contains every one of them (40/40 enabled rules fire; B181/6700 asserted absent as `disabledNotExpected`). QA: `l2-boundaries` "repeat-evaluation determinism", `phase2-pipeline` snapshot meta has no `batchId`. |
| AC3 M4/M5/M6 rejected by B5 with the right event types; M1/M2/M3 zero CME | **PASS** | `phase2.spec.ts` "AC3": line 59 TERFIN -> B5 `ALREADY_TERMINATED` (TER), line 60 RETFIN -> `TERMINATION_CODE_DEC`, line 61 RETFIN -> `RET_WITH_CTSRV_IN_YEAR` 2026, all REJECTED; happy-terfin/decfin/retfin batches VALIDATED with `findings = 0` (stronger than "zero CME"). QA `l2-boundaries` "B5 event-type matrix" covers DECFIN variants and RET-without-CTSRV. |
| AC4 B40 warning holds the batch in VALIDATED with a HELD row; override with a listed reason -> ACCEPTED + `WarningOverridden`; unlisted reason -> 422 | **PASS** | `phase2.spec.ts` "AC4": held 8 -> override line 77 B40 -> `rowOutcome ACCEPTED`, `heldRemaining 7`, status stays VALIDATED, `WarningOverridden` on `member:<pseudo>` + `MemberRecordValidated` with `overrides[]`, 422 `REASON_NOT_ALLOWED`, 422 `NOTE_REQUIRED`, 409 on repeat, Submitter 403, chain verifies. QA extensions in section 6. **UI gap**: the overview page did not surface HELD rows (BUG-UI-P2-1, fixed, section 5). |
| AC5 offline re-validate from the persisted `silver/ariel-snapshot.ndjson` reproduces identical findings | **PASS with a caveat** | `phase2.spec.ts` "AC5" (byte-identical after a live config change) and QA `phase2-pipeline` (byte-identical after every mock employment was closed). **Caveat BUG-REVAL-1**: `revalidateOffline` reads rate tables from the live adapter, not from the snapshot; changing MGA 2026 in the mock changes the offline result (`it.fails` probe). AC5 holds only while rate tables are immutable. |

## 4. Rule conformance audit (41 L2 rules + helpers) vs v15.1

Verdicts: **conforms** (logic, id, severity, section, tolerance, params, override list, messages verbatim); **deviates (documented)** = deliberate and written in architecture section 18; **deviates (undocumented)** = code comment only; **ambiguous** = spec silent, choice recorded here. Evidence = `tests/qa/l2-boundaries.spec.ts` unless stated; base specs are `tests/rules/<id>.spec.ts`.

| Rule / id | Verdict | Evidence / notes |
|---|---|---|
| B2 / 1418 | conforms | Unknown SIN -> `MEMBER_NOT_FOUND`; member employed elsewhere -> `NO_EMPLOYMENT_AT_EMPLOYER`; in both cases every other Ariel rule is skipped (engine `memberUnknown`). Two Ariel members sharing the SIN: B2 passes if any has an employment here (B204 rejects anyway). |
| B204 / 6279 | conforms | `membersBySin().length >= 2`; provisional derivation uses the first member by `memberId` for the other rules (row is rejected by B204 regardless). |
| B224 / 3001 | conforms | Two open employments at 0235 -> fires; closed + re-opened -> clean and the most recent permanency is the one evaluated (`employmentFor`). |
| B5 / 5728 | conforms (Final Data R14 variants) | TERFIN: any `terminationDate` (even RET) rejects; RETFIN/DECFIN: TER/DEC/AMA reject; RET rejects only with CTSRV whose `Year(targetDate)` = event year (2025 CTSRV passes). Concurrent member: only the reporting employer's employment (M16 in golden). DECFIN year uses `EmploymentEndDate` (Q1). |
| B223 / 2953 | conforms (Q23 config) | Fires on FileDerived service/contribution `targetDate < MergerEffectiveDate(indicator)`; employer gate from `nhhEmployers`. Golden line 62. |
| B109 / 7476 | conforms | `EventDate == permanencyDate` passes, one day earlier fires; DECFIN with a DateOfDeath column reports field `DateOfDeath`, CSV fallback reports `EmploymentEndDate`. |
| I42 / 8106 | conforms + deviates (documented Q5) | Unchanged from Phase 1. Interplay: a future date rejects the row but the other L2 rules still run (all rules in a level); I2 suppresses I42 together with every L2 rule. |
| B112 / 1616, 8112 | conforms | `{1/2}` placeholder rendered as Termination/Death; ID chosen by event type; TERFIN+RetNotice and DECFIN+RetNotice both in golden (lines 64/65). |
| B113 / 9075 | conforms | RETFIN without `RetNotice YYYY-MM-DD` in `otherInformation`. |
| B139 / 2492 | conforms | Fires only when `terminationCode = RET` **and** Ariel has a termination date different from the file (RET without a date -> quiet; TERFIN -> quiet); `{0}` rendered MM-DD-YYYY. Calculation indicator on override is Phase 3 (Q13). |
| B192a / 405 | conforms | Any CY/PY value > 0 and an MDC CTSRV (`summaryAttribute` "MDC - Core Data", dash-insensitive) in that year. |
| B192b / 7166 | conforms | Blank != 0 (zeros satisfy); field = first blank column; enrolled in the event year -> quiet; MDC 2025 posted -> quiet. |
| B22 / 5604 | conforms | PY window end = EventDate - 1 year inclusive (2025-09-30 fires, 2025-09-29 not); PA counts for CY only (spec omits PA for PY). |
| B19 / 9815 | conforms | WSO must start <= MAX(Jan 1, permanency) and end > EventDate (CY) / > Dec 31 (PY). |
| B19b / 2955 | conforms + **ambiguous** | PY: REPORT rate in Y-1 or Year(permanency) > Y-1 suppresses. An **all-blank PY block is not evaluated** (architecture 7.3) although the spec reads blank AE as "0 or blank" - pinned; confirm with HOOPP. |
| B31 / 7309 | deviates (documented Q6) | WARNING with the spec's single override reason instead of CME. Window keyed on the **execution** year: Dec 8 and Dec 31 fire, Dec 7 and Jan 1 do not; event year irrelevant; any weeks > 0 quiet. |
| B33 / 5001 | deviates (documented Q7) | CY service clause uses the termination year. PT-any-day boundary: PT effective Dec 31 counts, Jan 1 next year does not. |
| B37 / 3029 | conforms (Final Data variant) | `Low - Calc > MaxWeekly x 2` strictly; zero weeks still allows two weeks of contributions (197.97 passes, 197.98 fires in 2026); `{2}` = Calc + Tolerance; Tolerance2 ($5) is Core Data only and correctly unused (exposed as a config key but has no effect - cosmetic). |
| B38 / 480 | conforms | `Low < Calc - MaxWeekly` with High > 0; equal passes, one cent below fires; both override reasons verbatim (curly apostrophe preserved). |
| B40 / 1238 | conforms + **deviates (undocumented Q27)** | +15.000 % passes, +15.001 % fires; `{1}` two decimals; spec loop (last triggering ValidationYear wins, ErrorYear = event year) implemented. Q27: a year whose AE evaluates to 0 is skipped. Harmless for B40/B41. |
| B41 / 6065 | conforms (PRIVATE INFORMATION) | 50 % variant, same loop. |
| B43 / 5613 | **deviates (undocumented Q27)** | -2,500 passes, -2,501 fires, `{1}` = prev - cur. But a current year with **no service (AE 0)** after a 100,000 year is not a decrease here, whereas the spec loop would fire (`0 < 100000 - 2500`). Pinned as current behaviour; needs architecture entry + HOOPP decision. |
| B44 / 1646 | deviates (undocumented Q27) | as B43 (PRIVATE INFORMATION). |
| B47 / 2990 | conforms + deviates (documented) | 120,000 / 20,000 themselves pass; `{1}` = EventYear (spec: Year(ExecutionParameter.StartDate) - architecture choice). `AE <= 0` never fires (spec silent). **Robustness**: the back-walk from Year(permanency) calls the rate tables for every year with service -> BUG-L2-RATES-2. |
| B53a / 2160 | conforms | `CalcPA - PA <= -250 OR >= +250`: with CalcPA 10,083.00 exactly, PA 10,333 and 9,833 fire, 10,332 and 9,834 pass; `{4}` whole dollars; LTD years skipped; PA 0 with nothing reported skipped. |
| B53b / 7375, 8795 | deviates (documented Q8, Q22) | Situations 1-3, FASRV before 2017, stored ACW factor; tolerance 0 compares the **rounded** CalcPA (B53a compares unrounded) - consistent with "{4} rounded". Same pre-2015 rate exposure as B47 via `aeContributions`. |
| B181 / 6700 | conforms, disabled (Q21) | Toggle works (`phase2.spec.ts` rules API). |
| B182 / 9810 | conforms | High blank treated as 0, weeks/low must be literal 0. |
| B184a / 66 | conforms | PY 2025 full year: 52.00 passes, 52.01 fires; `suggestedWeeks` = ES - Ariel CTSRV; carve types LTD, NCM, NCU, WSN, WSO, PTW, NCD (R15 list). |
| B184b / 3002 | conforms | Mid-year enrolment window [MAX(Jan 1, permanency), MIN(Dec 31, event)] (Q26: Ariel.TerminationDate read as the event date - undocumented but matches the File.TerminationDate reading in the sibling rules). |
| B184c / 7854 | conforms + **deviates (undocumented Q25)** | 273-day window -> ES 38.90, RS = ES + 3 passes, + 3.01 fires. Breaks are clipped at EventDate + 1 instead of the spec's (Y+1)-01-01 - the spec text would over-carve a break running past the termination; sensible, but not in architecture section 18. |
| B185 / 3506 | conforms | Owns [ES - 1, ES): 51.00 and 51.99 fire, 52.00 and 50.99 do not; REGUL counted (spec omits the REGUL filter here); strict `permanency < Jan 1`. |
| B186a / 573 | deviates (documented Q10) | Events minimum ES - 1: 50.99 fires, 51.00 passes. Note: a PY block of zeros for a full-year member fires B186a (RS 0 < 51) - consistent with the spec; B192b's advice "report zero weeks" therefore leads to B186a (expected, flag to HOOPP). |
| B186b / 3466 | deviates (documented Q10) | Event before Dec 31 of Y -> not evaluated (spec File.TerminationDate condition). |
| B186c / 9829 | deviates (documented Q10) | `RS < 0.65 x ES`: 25.28 passes (25.2785), 25.27 fires. |
| B202 / 6908 | conforms (data-quality guard) | >= 2 Ariel addresses with the same effective start date. |
| B203 / 619, B205 / 1070 | conforms | Status/sub-status vs date inconsistency in Ariel or in the derived D-NCT item. |
| B206 / 619 | deviates (documented Q17) | Derived D-NCT effective date = MAX(EventDate, other employments' termination dates) clashing with `statusHistory`. |
| B207 / 2153 | conforms | Same employer + calculation year + `entryDate = ExecDate`. |
| B214 / 6012 | conforms | 5-day leave threshold (`B214.minLeaveDays`, new key): 5 days evaluated, 4 ignored; WCP = ROUNDDOWN((273 - 5)/273 x 52) = 51.04, + 0.14 tolerance; End = EmploymentEndDate + 1 (TERFIN/RETFIN) or DateOfDeath (DECFIN). |
| Carve-out helper | conforms (literal) | Union length under nested, chained, pre-window and enclosing overlaps; open-ended breaks clipped at the exclusive window end; a break ending on the window start contributes 0. |
| Rate tables | **gap** | `StaticRateTables.get` throws for a missing year; every consumer (B37, B38, B40-B44, B47, B53a/b) propagates it -> engine `SYS-RULE-ERROR`. See BUG-L2-RATES-1/2. |

## 5. Bugs found (ordered by severity)

Test column: `it.fails(...)` = failing-on-purpose probe that flips red when the bug is fixed; "pinned" = test asserting the current (questionable) behaviour so a silent change in either direction is caught.

| # | Sev | Title | Repro | Expected vs actual | Suggested fix | Test |
|---|---|---|---|---|---|---|
| BUG-L2-RATES-1 | **Major** | Rate-table lookups throw for any year outside the placeholder tables (2015-2026); the engine converts the throw into `SYS-RULE-ERROR` (CME, **PRIVATE**) so the row is rejected **with no PUBLIC reason** | TERFIN 2027-03-31, execution date 2027-10-08, member with 2025/2026 history (`l2-boundaries` "BUG-L2-RATES-1") | Expected: the rule skips or reports a specific finding (rules must not throw - architecture 7.1); actual: B37, B38, B40, B43, B53a (and B41/B44/B53b) each raise `RateTableMissingError: rate table MGA has no value for year 2027`; the Submitter sees a rejected row with zero findings in the public summary | Make `ArielRateTables` lookups non-throwing at the rule boundary (`calculateAE`/`lowContributionCalc`/`calculatedPA` return `null` -> rule emits no finding and records `calculated.skipped = "RATE_MISSING:<table>:<year>"`), or add a PUBLIC INFORMATION finding; seed the rate tables for every year that can appear in history (Q9) | `l2-boundaries` "BUG-L2-RATES-1 (current behaviour)" (pinned) |
| BUG-L2-RATES-2 | **Major** | B47 (and B53b `aeContributions`) walk back to `Year(permanencyDate)`; any member with pre-2015 CTSRV + contributions is rejected via `SYS-RULE-ERROR` | Member permanency 2010-01-04 with a 2010 CTSRV/RPPLOW row + a clean 2026 TERFIN (`l2-boundaries` "BUG-L2-RATES-2") | Expected: clean row (B47 exits on the first year with AE > 0 **in the spec**, but it needs the 2010 rates to compute it); actual: `SYS-RULE-ERROR` for B47 (`LOWRATE has no value for year 2010`), row REJECTED. In production data most long-service members have such history - every one would be rejected | Same as RATES-1; additionally start the B47 loop at `MAX(Year(permanency), firstRateYear)` and treat years without rates as "no AE" | `l2-boundaries` "BUG-L2-RATES-2 (current behaviour)" (pinned) + "same member with service only in covered years is clean" |
| BUG-REVAL-1 | **Major** | Offline re-validation (AC5) is not isolated from rate-table changes: `revalidateOffline` calls `ctx.ariel.rates()` (live), the snapshot NDJSON carries no rates | `phase2-pipeline` "BUG-REVAL-1": set `MGA 2026 = 50000` in `ariel_mock.rate_tables`, re-validate the golden batch | Expected byte-identical `findings.ndjson`; actual differs (B37/B53a results change) | Persist the rate rows (and their hash) with the snapshot (`silver/ariel-snapshot.ndjson` meta or `silver/rates.json`), read them in `revalidateOffline`; fold the rates hash into `arielSnapshotHash` | `phase2-pipeline` `it.fails("BUG-REVAL-1 ...")` + sanity test after restore |
| BUG-UI-P2-1 | **Major (UI) - FIXED** | Batch overview computed `heldCount` from `recordOutcomeCounts().pending` (null outcomes); Phase 2 writes `outcome = HELD`, so the "N held rows need an override" copy and CTA never appeared and a VALIDATED batch with HELD rows read "Ledgering..." (Reviewer) / "Validation complete. Writing results..." (Submitter) | Upload `mixed-100-rows`, open `/batches/{id}` as Reviewer (API `counts.held = 8`) | Expected "8 held rows need an override" + "Open held rows"; actual "Ledgering..." - confirmed by HTTP probe before the fix | `heldCount = c.held` in `src/app/(app)/batches/[batchId]/_lib.ts` (1 line + comment) | `e2e:qa` "Phase 2: Reviewer overview of a batch with HELD rows says N held rows need an override (not Ledgering)" + "Open held rows CTA links to the warnings filter" |
| GAP-SCOPE-1 | Major (scope) | Section 17 Phase 2 scope lists the warning-override UI (HELD rows tab / OverrideDrawer), the Mock Ariel browser page and the Admin rules page; none are in `3ebad53` (no `src/app/(app)` or `src/components` change) | `git diff 94496ff..3ebad53 --stat -- "src/app/(app)" src/components` -> empty | Backend is complete and tested through the API; the UI pass must deliver these on top of the response-shape changes in section 2.2 | - | - |
| DEV-DOC-1 | Minor (doc) | Code cites architecture section 18 **Q25** (B184c clip at EventDate + 1), **Q26** (Ariel.TerminationDate read as the event date in B184b/c, B186), **Q27** (B40-B44 skip when the current-year AE is 0) - the document ends at Q24 | `grep -n "Q2[5-9]" src docs` | Q27 is a behavioural deviation (B43/B44 would fire on a drop to zero per the spec loop) and needs a HOOPP decision; Q25/Q26 are reasonable readings that must be recorded | Add Q25-Q27 to section 18 with the defaults adopted | `l2-boundaries` "DEVIATION (pinned): a year with no service (AE = 0) ... is NOT a B43/B44 decrease" |
| BUG-E2E-1 | Minor (test) - FIXED | Both browser suites used an unscoped `getByTestId("verify-button")`; the shell banner and the ledger page each render one -> Playwright strict-mode violation aborted `e2e:phase1` after 27 checks and `e2e:qa` after 50 | run either suite as Admin on `/ledger` | Pre-existing since `681cee3` (Phase 1 fix pass); the developer's own run failed the same way | Locators scoped to `#main` in `scripts/e2e-phase1.mjs` and `tests/e2e/phase1-qa.mjs` | both suites green (section 1) |
| GAP-RULES-1 | Minor | `DELETE /api/rules/{ruleId}` with an unknown rule id answers **200** `{ rule: undefined, ledgerSeq: null }` (PATCH answers 404) | `DELETE /api/rules/NOPE` as Admin | Expected 404 `NOT_FOUND` | `ruleById()` guard in `resetRuleConfig` | `phase2-pipeline` "GAP-RULES-1 (pinned)" |
| GAP-RULES-2 | Minor | Tolerance PATCH is type-checked only: `B40.pct = -1`, `B47.min = 500000` (> max), negative weeks are accepted and change the config hash | `PATCH /api/rules/B40 { tolerances: { "B40.pct": -1 } }` | Expected 422 `INVALID_TOLERANCE`; actual 200 | Add per-key ranges to `TOLERANCE_KEYS` (min/max, sign) and validate `B47.min < B47.max` | `phase2-pipeline` "GAP-RULES-2 (pinned)" |
| GAP-OVR-1 | Minor (design) | A WARNING on an already REJECTED row can be overridden: 200, `rowOutcome REJECTED`, a `WarningOverridden` ledger entry for a row that can never be accepted; `heldRemaining` unchanged | pick a warning whose row also has a CME in `mixed-100-rows` | Architecture 7.5 says overrides are per finding, so this is legal; UX should hide/disable the action on rejected rows (or the API could answer 409 `ROW_REJECTED`) | decide in the UI pass | `phase2-pipeline` "a warning on a REJECTED row may be overridden ..." (pinned) |
| GAP-ENV-1 | Minor (env, pre-existing) | With `LOG_PRETTY=true` (the `.env.example` default) pino's pretty transport fails to load under Next 15.5 / Node 22 (`Directory import ... pino-pretty is not supported resolving ES modules`; `uncaughtException: the worker has exited`, 222 occurrences in one dev run); requests are served but **logs are lost** | `npm run dev` or `npm run start`, open any page | Expected pretty logs; actual repeated uncaught exceptions | Load `pino-pretty` through `pino.transport({ target: "pino-pretty" })` only outside the Next bundle, or default `LOG_PRETTY=false` and pipe through `pino-pretty` on the CLI | - |
| GAP-E2E-2 | Minor (test) | `scripts/e2e-phase1.mjs` "Overview shows 38 rejected" still passes although the Phase 2 overview shows 72 rejected (the check falls back to `body includes "38"`); the "salted" uploads append bytes to the last row (no trailing newline), which mutates its PA and shifts the counts (20/72 vs the golden 19/73) | run the suite | Stale Phase 1 expectation | Assert on `counts.rejected` from the API or the overview counter; salt with a comment-free extra row | - |
| FLAKY-E2E-1 | Minor (test) | `e2e:qa` "D12 (fixed): at 768px Upload is disabled" and `e2e:phase1` "rule filter narrows findings to one rule" each failed once in three runs against the dev server (hydration / menu timing) and passed otherwise | repeat runs | Deterministic checks | Wait for hydration (`useIsDesktop` resolves after `matchMedia`) before asserting; wait for the menu to be `stable` before clicking | - |
| COS-P2-1 | Cosmetic | Seed member names M16-M18 differ from architecture 4.6 (QUINN/ROSS/SINGH vs PATEL/QUINN/ROSS); `B37.tolerance2Dollars` is exposed as an Admin tolerance although the Final Data variant never uses it; `GET /api/rules` lost the Phase 1 `implemented` field | - | - | align seed names or the doc; drop or label the unused key | - |

Trivial fixes applied to `src/`: **one** (BUG-UI-P2-1, `src/app/(app)/batches/[batchId]/_lib.ts`, 1 line + comment). Test-code fixes: BUG-E2E-1 (two scripts).

## 6. Override and HELD semantics

| Check | Result | Evidence |
|---|---|---|
| Role matrix | Reviewer/Admin allowed; EmployerSubmitter 403 unless `ALLOW_SUBMITTER_OVERRIDE` **and** own employer (other employer -> 404, no existence leak); anonymous 401 | `phase2.spec.ts` AC4 + "ALLOW_SUBMITTER_OVERRIDE" |
| Non-WARNING finding | 422 `NOT_OVERRIDABLE`; file-level findings 422 | `phase2.spec.ts` |
| Reason not in the rule's list | 422 `REASON_NOT_ALLOWED` with `details.allowed` | `phase2.spec.ts` |
| "Other" reason | note required (422 `NOTE_REQUIRED`, whitespace-only rejected); note trimmed, persisted (`override_note`), returned, in the `WarningOverridden` payload | `phase2-pipeline` "an Other reason needs a note ..." |
| Double override | 409 `ALREADY_OVERRIDDEN`; idempotency is **not** silent (second call is an error, no second ledger entry) | `phase2.spec.ts` |
| Batch moved on | 422 `BATCH_NOT_VALIDATED`, nothing persisted | `phase2-pipeline` "overrides are refused once the batch has left VALIDATED" (status forced to LEDGERED in DB) |
| Row with two warnings | first override -> `rowOutcome HELD`, second -> `ACCEPTED`; `MemberRecordValidated` written once, listing both overrides | `phase2.spec.ts` bulk (line 74, two B33) |
| Bulk override | **per item, not atomic** (matches docs/ux-design.md 5.4.2); bad id in the middle -> 207, the others succeed, one ledger entry each; all-fail -> 422 `NO_OVERRIDE_APPLIED` | `phase2-pipeline` "bulk override is per item" + `phase2.spec.ts` |
| Warning on a REJECTED row | allowed, row stays REJECTED, no `MemberRecordValidated` (GAP-OVR-1) | `phase2-pipeline` |
| Ledger payload | `WarningOverridden { findingId, recordId, lineNumber, sinMasked, ruleId, messageId, yearScope, reason, note?, rowOutcome }` on `member:<pseudo>`; `MemberRecordValidated.overrides[]`; no SIN/name/DOB; `override_ledger_seq` stored on the finding and returned as `finding.override.ledgerSeq` | `phase2.spec.ts`, `phase2-pipeline` PII sweep |
| Chain integrity after overrides | `verify().ok === true` after single, bulk and partial-failure overrides | `phase2.spec.ts`, `phase2-pipeline` |
| Config hash on the batch | `batches.rules_config_hash` stamped by validate, unchanged by overrides; `heldTotal` = count of `outcome = HELD`; `warnings` count unchanged (overrides do not remove findings) | `phase2-pipeline` "after all overrides" |
| Summary of Validations after overrides | public CSV `Overridden` column increments; PRIVATE rows and SYS rows only in the private CSV; formula cells neutralised | `phase2.spec.ts` |

## 7. Rules configuration

Admin enable/disable and tolerance edits are ledgered as `RulesConfigChanged` on the `system` stream (payload `{ previousHash, newHash, changes[{ruleId,key,from,to}], reason }`) and audit-logged (`RULES_CONFIG_CHANGED`); the effective hash changes and is stamped on later batches (`rulesConfigHash` + `silver/rules-config.json`); no-op patches produce no entry; `GET /api/rules/history` (Reviewer/Admin) lists them newest first; non-Admin PATCH/DELETE -> 403, anonymous 401; unknown rule -> 404 (PATCH); wrong-rule or unknown tolerance key -> 422 `UNKNOWN_TOLERANCE`; wrong type / bad `MM-DD` -> 422 `INVALID_TOLERANCE`; empty patch -> 400 (`phase2.spec.ts` "rules configuration API"). QA additions: disabling B40 affects **new batches only** - the earlier batch keeps its B40 findings and its hash, the new batch has none and carries the new hash; after `DELETE` the hash returns to the file hash (`phase2-pipeline` "disabling B40 affects new batches only"). Engine-level: `enabled=false` removes B40 while B41 keeps running (`l2-boundaries`). Gaps: GAP-RULES-1 (DELETE unknown rule 200), GAP-RULES-2 (no range validation).

## 8. Security / PII

| # | Sev | Finding | Status / evidence |
|---|---|---|---|
| PASS | - | `silver/ariel-snapshot.ndjson`: members keyed by `sinPseudo` + `sinMasked`, **no `sin` key, no seed SIN anywhere**; meta line has no `batchId`. It does carry `lastName`, `firstName`, `dateOfBirth` (needed by B53b DOB + 65 and the mock browser) - silver zone, download restricted to Reviewer/Admin (403 for Submitter, not even listed in `reports[]`). Architecture 9.7 forbids names/DOB only in **ledger payloads**; recommend stating the silver-zone rule explicitly. | `phase2-pipeline` "ariel-snapshot.ndjson carries pseudonym + mask only" |
| PASS | - | No seed SIN in `findings.ndjson`, both summary CSVs, `rules-config.json`, the findings API, or any of the 90+ ledger payloads of the golden batch; public CSV has no PRIVATE / SYS-RULE-ERROR / B41 / B44 / B182 rows | `phase2-pipeline` PII sweep; `phase2.spec.ts` |
| PASS | - | PRIVATE findings hidden from Submitters in the findings API and the public CSV; private CSV, snapshot and config downloads 403 for Submitters | `phase2.spec.ts` |
| PASS | - | Mock Ariel API: `/api/ariel/members*` Reviewer/Admin only (Submitter 403, anon 401), SIN masked in every item; `/api/ariel/rates` any session; `/api/ariel/reseed` Admin only and 404 in production; reseed is idempotent (member lines of a later snapshot identical) | `phase2.spec.ts`, `phase2-pipeline` |
| PASS | - | Rules config mutation Admin-only; history Reviewer/Admin; `GET /api/rules` anonymous by design (architecture 11 "any") - exposes rule texts and tolerances only | `phase2.spec.ts` |
| PASS | - | Override endpoints: employer scoping via 404, Submitter 403 by default, `x-forwarded-for` validated before it is audit-logged | `phase2.spec.ts`, code (`override.ts`) |
| INFO | Low | `SYS-RULE-ERROR` findings embed the exception message in `params.error` (PRIVATE); with BUG-L2-RATES-1 that is only a rate-table message, but any future rule exception text (could contain cell values) would be persisted and shown to HOOPP roles | sanitise `params.error` like `failureReason` (Phase 1 SEC-INFO-1) |
| INFO | Low | Phase 1 posture unchanged: identity headers stripped by middleware, dev login disabled in production (verified: `/login` 404 under `next start`), no raw SIN outside `raw/original.csv` and `rejected.csv` | Phase 1 suites still green |

## 9. Performance (dev laptop, PGlite in-memory)

| Scenario | Rows | Phase 1 (L0/L1 only) | **Phase 2 (L1 + snapshot + derivation + 41 L2 + member ledger entries)** | Offline re-validate |
|---|---|---|---|---|
| golden `mixed-100-rows` | 100 | - | ingest 46 ms, run 669 ms, **0.71 s** total; 116 findings, ledger head 94 | 61 ms |
| 1,000 rows, every SIN a seeded member with 2024/2025 MDC history (full L2 path, 0 findings, 1,000 `MemberRecordValidated`) | 1,000 | - | ingest 23 ms, run 4,285 ms, **4.3 s** total; RSS 492 MB | 468 ms |
| clean-100 (SINs not in Ariel -> B2 rejects all) | 100 | 0.53 s | **0.69 s** (ledger head 102) | - |
| clean-1000 | 1,000 | 1.9 s | **4.2 s** | - |
| clean-5000 (section 15 budget: validate < 60 s) | 5,000 | 7.7 s | **17.6 s** (5,000 `MemberRecordRejected`) | - |
| mixed-5000 | 5,000 | 14.1 s | **16.1 s** | - |
| `verify()` | - | 2,008 entries 3.06 s (~650/s) | 11,108 entries 13.7 s (**~810/s**); 1,096 entries 1.04 s | - |

Phase 2 adds roughly 2.3 ms per row for snapshot + provisional derivation + L2 (clean-1000: +2.3 s) and one member ledger entry per accepted/rejected row (the dominant cost at 5,000 rows: 5,000 appends in chunks of 500). All within the section 15 budget; memory flat. Commands: `npm run test:perf` (Phase 1 scenarios) and `npx vitest run --config vitest.perf.config.ts tests/perf/phase2-perf.spec.ts`.

## 10. New tests and wiring

| Area | File | Tests |
|---|---|---|
| L2 boundary probes: catalogue invariants, rate-table gaps (2 pinned bugs), B40/B43 thresholds + Q27 pin, B53a +/-250, B184c/B186c, B184a/B185/B186a hand-over, B31 window, B109, B139, B5 matrix, absent/partial Ariel paths, I42/I2 interplay, B19b PY, B22 PY window, B214 5-day threshold, B33 PT boundary, B37/B38 at the cent, B47 bounds, B192b blank vs zero, config enable flag, repeat determinism, carve-out algorithm (6 overlap shapes) | `tests/qa/l2-boundaries.spec.ts` | 42 |
| Pipeline probes: snapshot/report/ledger PII posture, offline isolation from mock mutation, BUG-REVAL-1 (`it.fails`), override on rejected row, Other-note handling, batch-not-VALIDATED, non-atomic bulk, post-override invariants, disabled-rule effect boundary, GAP-RULES-1/2 pins, mock Ariel role matrix + reseed idempotency | `tests/qa/phase2-pipeline.spec.ts` | 14 (13 + 1 expected fail) |
| Phase 2 perf smoke (golden mixed-100, 1,000 seeded members through full L2, verify) | `tests/perf/phase2-perf.spec.ts` | 3 (opt-in, `vitest.perf.config.ts` picks it up automatically) |
| Browser E2E: scoped `verify-button` locators (BUG-E2E-1), Phase 2 HELD "Next step" copy + CTA checks | `tests/e2e/phase1-qa.mjs`, `scripts/e2e-phase1.mjs` | +2 checks |
| **Total vitest (default run)** | | **576 -> 632 passed, 1 skipped, 1 expected fail** (88 files) |

Coverage after the additions (`npm run test:coverage`): see the table in section 1 (`src/lib/rules` unchanged at >= 98 % lines; `carve-out.ts` branches now covered). No new dependencies, scripts or config.

## 11. Release recommendation: **GO with fixes** (Phase 2 backend, dev/demo scope)

AC1-AC5 hold: all 41 L2 rules are implemented, unit-tested with yearScope and multi-ID cases and 98 % line coverage; the golden file is byte-deterministic across runs and contexts and exercises every enabled L2 message id; the seed outcomes match; warning overrides hold/release rows exactly as section 7.3 and 10.1 describe and are ledgered with a verifying chain; offline re-validation reproduces the persisted findings. Rule logic conforms to v15.1 wherever the spec is unambiguous; the deliberate deviations are the documented Q5-Q10/Q13/Q17/Q21-Q23 ones plus three undocumented readings (Q25-Q27) that must be written down. Phase 1 does not regress (both browser suites green after a test-script fix, axe 0/0/0/0).

Fix before building Phase 3 on this base:

1. **BUG-L2-RATES-1/2** - rate lookups must not throw; today any event year or member history outside 2015-2026 rejects the row with a private-only reason. One-line guard in `StaticRateTables`/the three helpers + B47 loop start.
2. **BUG-REVAL-1** - persist the rate tables with the snapshot so AC5 is genuinely offline.
3. **DEV-DOC-1** - add Q25-Q27 to architecture section 18 and get HOOPP's answer on Q27 (B43/B44 on a drop to zero AE).
4. **GAP-SCOPE-1** - the Phase 2 UI (override drawer / HELD tab, `/ariel`, `/admin/rules`) is still to be built; the UI pass must also absorb the response-shape changes in section 2.2 (`counts.held`, `outcome = HELD`, `GET /api/rules` shape, new reports list).
5. GAP-RULES-1/2, GAP-OVR-1, GAP-ENV-1 (logging) and the stale/flaky E2E checks are minor and can ride along.

Open spec questions for HOOPP (new in Phase 2): Q27 (zero-AE year in the B40-B44 loop), B19b with an all-blank previous-year block, B47 message parameter `{1}` (event year vs execution year), B184c carve clip (Q25), B186a firing on the zero previous year that B192b asks for, whether a warning on a rejected row should be overridable.

## 12. Commits

Branch `main`, not pushed. Base: `3ebad53` (Phase 2 backend).

| Hash | Commit |
|---|---|
| (see below) | test(qa): L2 boundary probes, rate-table gap and Q27 pins, carve-out overlap cases |
| (see below) | test(qa): Phase 2 pipeline probes - PII posture, offline isolation (BUG-REVAL-1), override/HELD edges, rules-config boundaries; Phase 2 perf smoke |
| (see below) | fix(ui): batch overview counts HELD rows for the next-step copy (BUG-UI-P2-1); test(e2e): scope verify-button locators, add HELD copy checks |
| (see below) | docs(qa): Phase 2 QA report |
