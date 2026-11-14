# Agent Note: Recent library feeds preserve ledger order at equal timestamps

Status: implemented

## Problem

`recentChanges` and `recentRecords` present the newest library events first. The event file is oldest-first, but both feeds sorted only by the `at` timestamp. Multiple events in one millisecond kept their original order, so an older chat recording could precede a later quiz assessment.

The forward-compat CI assertion expected the new quiz recording but saw the older chat recording. Other runs passed because their event timestamps differed. The feed's order therefore depended on timing rather than the write sequence.

## Decision

Both feeds reverse the collected events before the stable timestamp-descending sort. Events with different timestamps still sort by `at`; events with the same timestamp retain the event ledger's newer-first order. The stored log, timestamp precision, and file format do not change.

## Alternatives considered

- **Add a sequence number or increase timestamp precision.** Rejected: the durable event log already has an order, so no schema or migration is needed for this read-side fix.
- **Prefer quiz events over chat events.** Rejected: source-type priority is not chronological order and would hide newer chat events in other cases.
- **Treat the CI failure as unrelated flakiness.** Rejected: the code explicitly returned the oldest event first when timestamps tied, so this was a real ordering defect even though it only appeared in one job.

## Consequences

The home feed and recent-record view have deterministic order when writes share a millisecond. A later assessment no longer appears after an older chat merely because both carry the same `at` value. No data migration, host-version requirement, or new setting is needed.

## Testing

The assess-cascade scenario in `packages/library/tests/service.spec.ts` now pins all event timestamps to one millisecond. It checks the chat recording followed by the quiz assessment, including `recentRecords()[0].source === 'quiz'`; the 65 service tests in that file pass. Timer state is restored after every test. The complete library package also passed its build and all 221 tests.

## Related

- [Recent library feeds preserve ledger order at equal timestamps](2026-11-14-local-agent-reattach-lease-race.md) — the independent session-handle lifecycle fix in the same release wave.
