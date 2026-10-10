# Phase 2B progress log

Running log for the Phase 2B pass (QA fixes + Phase 2 UI). Base `cec41e7`.

## Done

- Part 1.1 BUG-L2-RATES-1/2: `ArielRateTables` lookups return `null`; `calculateAE` / `lowContributionCalc` / `calculatedPA` return `null`; B37/B38/B40/B41/B43/B44/B47/B53a/B53b skip with `RATE_MISSING:<table>:<year>` (engine `skips`, `RuleTiming.skipped`, execution report `ruleSkips`); B47/B53b back-walk starts at `MAX(Year(permanency), firstRateYear)`; placeholder rates 2010-2027 (`tests/fixtures/ariel-seed.json` rateTables = 90). Tests: `tests/qa/l2-boundaries.spec.ts` "BUG-L2-RATES-1/2 (fixed)".
- Part 1.2 BUG-REVAL-1: snapshot NDJSON carries a `{"kind":"rates"}` line (folded into `arielSnapshotHash`); `revalidateOffline` reads only the frozen rates; live run also validates with the frozen rates. Test: `phase2-pipeline` "BUG-REVAL-1 (fixed)". Golden `expected-findings.ndjson` unchanged.
- Part 1.5 SEC INFO: `SYS-RULE-ERROR` message = generic text + deterministic reference; full error via `EngineDeps.onRuleError` -> pino.

- Part 1.3 GAP-RULES-1/2: `TOLERANCE_KEYS` carry min/max/note; `toleranceProblem` + `validateToleranceSet` (B47.min < B47.max) -> 422 `INVALID_TOLERANCE`; `DELETE /api/rules/{unknown}` -> 404. Tests: `phase2-pipeline` "GAP-RULES-1/2 (fixed)".
- Part 1.4 GAP-OVR-1: override on a REJECTED row -> 409 `ROW_REJECTED` (single + bulk per-item); architecture 7.5 note. Test: "GAP-OVR-1 (fixed)".
- Part 1.6 GAP-ENV-1: pino-pretty transport targets `node_modules/pino-pretty/index.js` (directory import crashed the worker); `.env.example` `LOG_PRETTY=false`.
- Part 1.7 DEV-DOC-1 / COS-P2-1: architecture 18 Q25-Q27 (+ Q9 range), 11 route table (rules PATCH/DELETE/history, override routes, GET /api/rules/{id} added), 4.6 M16-M18 names aligned to the seed; `implemented` restored on the catalogue; tolerance min/max exposed.
- Part 1.8 GAP-E2E-2 / FLAKY-E2E-1: both browser suites salt with one extra B2-rejected row and assert API `counts` = golden + 1; D12 waits for hydration; rule-filter menu waits for stability. Overview KPI cards got `kpi-*` testids.
- Full vitest: 636 passed / 1 skipped / 0 expected-fails.

## Next

- Part 2 UI items 11-15. Part 3 tests + gates.