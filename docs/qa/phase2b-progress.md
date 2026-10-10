# Phase 2B progress log

Running log for the Phase 2B pass (QA fixes + Phase 2 UI). Base `cec41e7`.

## Done

- Part 1.1 BUG-L2-RATES-1/2: `ArielRateTables` lookups return `null`; `calculateAE` / `lowContributionCalc` / `calculatedPA` return `null`; B37/B38/B40/B41/B43/B44/B47/B53a/B53b skip with `RATE_MISSING:<table>:<year>` (engine `skips`, `RuleTiming.skipped`, execution report `ruleSkips`); B47/B53b back-walk starts at `MAX(Year(permanency), firstRateYear)`; placeholder rates 2010-2027 (`tests/fixtures/ariel-seed.json` rateTables = 90). Tests: `tests/qa/l2-boundaries.spec.ts` "BUG-L2-RATES-1/2 (fixed)".
- Part 1.2 BUG-REVAL-1: snapshot NDJSON carries a `{"kind":"rates"}` line (folded into `arielSnapshotHash`); `revalidateOffline` reads only the frozen rates; live run also validates with the frozen rates. Test: `phase2-pipeline` "BUG-REVAL-1 (fixed)". Golden `expected-findings.ndjson` unchanged.
- Part 1.5 SEC INFO: `SYS-RULE-ERROR` message = generic text + deterministic reference; full error via `EngineDeps.onRuleError` -> pino.

## Next

- Part 1.3 GAP-RULES-1/2, 1.4 GAP-OVR-1, 1.6 GAP-ENV-1, 1.7 DEV-DOC-1, 1.8 E2E script fixes.
- Part 2 UI items 11-15. Part 3 tests + gates.