# Phase 3A (backend) progress log

Base: `c094f53` (Phase 2 complete). Scope: architecture section 17 Phase 3 (backend half).

## Done

- **Step 1 - schema + types.** `drizzle/0003_phase3.sql`: `ariel_update_sets` loses the `batch_id` UNIQUE (one row per build; `build_no`, `counts`, `ledger_entry_id/seq`), `ariel_update_items` gains `record_id`, `line_number`, `event_type/date`, `year_scope`, `calculated`, `sin_masked`; `exports` paths/sha nullable + `format`, `files`, `manifest_*`, `batch_id`, `content_hash`; `batches` gains `update_set_id`, `approved_by/at`, `rejected_by/at/reason`, `reopened_by/at`, `exported_at`; `member_projections` gains `corrections`, `last_update_set`, `last_event_type`, `counts`. Types: `src/types/ariel-update.ts` (item core vs persisted item, set, approval, export, gold document), `src/types/projection.ts`, ledger payloads for `ArielUpdateProposed`, `UpdateSetBuilt/Approved/Rejected/Exported`, `CorrectionAppended`, new `BatchReopened` event type.

- **Step 2 - final derivation.** `src/lib/derivation/final/contributionSplit.ts` (pure; 1000 + 0.7 x PA limit, Q14 PA fallback, Q15 literal signs) and `src/lib/derivation/final/items.ts` (`deriveFinal`: sections 8.2-8.11 and 8.13 order; `itemsHash`, `contentHashOf`, `sortItems`). Tests: `tests/derivation/contribution-split.spec.ts` (5 worked examples + edges), `tests/derivation/final.spec.ts` (26 cases across every record type).

## Next

- Step 3 pipeline steps `ledger` + `build-projection`, gold writers, reports.

## Decisions

- D-P3-1: record types `Member` and `CalculationIndicator` added to the section 4.4 union (section 8.2 D-MBR-DOD, section 8.6 D-CALC-INDICATOR need them).
- D-P3-2: `BatchReopened` ledger event on the batch stream for Admin reopen (section 10.1 lists the transition; section 9 lacked an event for it).
- D-P3-3: rebuild after reopen inserts a new `ariel_update_sets` row (`build_no + 1`); the rejected row stays for audit. `batches.update_set_id` points at the current build.