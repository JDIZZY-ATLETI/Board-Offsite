# Phase 3A (backend) progress log

Base: `c094f53` (Phase 2 complete). Scope: architecture section 17 Phase 3 (backend half).

## Done

- **Step 1 - schema + types.** `drizzle/0003_phase3.sql`: `ariel_update_sets` loses the `batch_id` UNIQUE (one row per build; `build_no`, `counts`, `ledger_entry_id/seq`), `ariel_update_items` gains `record_id`, `line_number`, `event_type/date`, `year_scope`, `calculated`, `sin_masked`; `exports` paths/sha nullable + `format`, `files`, `manifest_*`, `batch_id`, `content_hash`; `batches` gains `update_set_id`, `approved_by/at`, `rejected_by/at/reason`, `reopened_by/at`, `exported_at`; `member_projections` gains `corrections`, `last_update_set`, `last_event_type`, `counts`. Types: `src/types/ariel-update.ts` (item core vs persisted item, set, approval, export, gold document), `src/types/projection.ts`, ledger payloads for `ArielUpdateProposed`, `UpdateSetBuilt/Approved/Rejected/Exported`, `CorrectionAppended`, new `BatchReopened` event type.

- **Step 2 - final derivation.** `src/lib/derivation/final/contributionSplit.ts` (pure; 1000 + 0.7 x PA limit, Q14 PA fallback, Q15 literal signs) and `src/lib/derivation/final/items.ts` (`deriveFinal`: sections 8.2-8.11 and 8.13 order; `itemsHash`, `contentHashOf`, `sortItems`). Tests: `tests/derivation/contribution-split.spec.ts` (5 worked examples + edges), `tests/derivation/final.spec.ts` (26 cases across every record type).

- **Step 3 - pipeline continuation.** `src/lib/pipeline/advance.ts`: `advanceBatch` (VALIDATED, HELD = 0 -> `stepLedger` -> LEDGERED -> `stepBuild` -> PROJECTION_BUILT -> PENDING_APPROVAL; HELD > 0 waits). `ArielUpdateProposed` per accepted row (payload = itemsHash + counts + D-NCT/termination summary, no PII beyond sinMasked), `CorrectionAppended` (section 9.6: earlier unexported proposal for same member/employer/eventType, or earlier rejection for same member/eventType/eventDate), `UpdateSetBuilt` on the batch stream with artifact hashes. Gold: `ariel-update-set.json/.csv`, `diff.md`, `reports/modified-fields-report.csv`, `transactions-report.csv`, `transactions-summary.csv` (`src/lib/pipeline/update-set/writers.ts`). `runBatch` now continues automatically (`{ advance: false }` opt-out); the override API continues when the last HELD row is released. INFO-RET-DNCT persisted as an INFORMATION finding. Member projector (`src/lib/projection/member-projection.ts`, step 5 pulled forward) runs after every ledger write. Phase 1/2 suites updated where they asserted the pre-Phase-3 terminal status `VALIDATED` (now `PENDING_APPROVAL` for batches without HELD rows); 700/700 green.

## Next

- Step 4 approval/export APIs.

## Decisions

- D-P3-1: record types `Member` and `CalculationIndicator` added to the section 4.4 union (section 8.2 D-MBR-DOD, section 8.6 D-CALC-INDICATOR need them).
- D-P3-2: `BatchReopened` ledger event on the batch stream for Admin reopen (section 10.1 lists the transition; section 9 lacked an event for it).
- D-P3-3: rebuild after reopen inserts a new `ariel_update_sets` row (`build_no + 1`); the rejected row stays for audit. `batches.update_set_id` points at the current build.