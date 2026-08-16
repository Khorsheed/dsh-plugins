# Agent Note: ankh-guard restart report survives the fallback path

Status: implemented

English | [中文](2026-08-15-ankh-guard-fallback-report-pending.zh.md)

## Problem

When the initiating session did not resume within `fallbackGraceMs` (default 60s), the grace-timer fallback delivered the restart report to another root agent and `claim()` acknowledged the record outright (`reportedAt`). The record was thereby settled: when the initiator's agent was created later, `pendingRestartRecord` returned null and the session that scheduled the restart never saw the report. Observed twice on the 3080 instance (2026-08-14 and 2026-08-15): the record was acked two minutes after restart while the report went to a different session, and the initiator's log shows no `[ankh-guard]` injection.

## Decision

Two-phase settlement for restart records in `packages/guard/ankh-guard`:

- `RestartRecord` gains `fallbackReportedAt`. Both fallback paths (grace-timer expiry and initiator-absent-from-persistence) deliver the full report but write only `fallbackReportedAt`; `pendingRestartRecord` still returns the record because settlement means `reportedAt` only.
- On `agent/created`, a record with `fallbackReportedAt` and no `reportedAt` is settled by nobody but the initiator: its resume receives a short notice (`restartFallbackNoticeText` — restart time, outcome, and the fact that the full report went to another session), then `reportedAt` is written. The notice path is synchronous on the freshly read record, so a second restart (new `exitAt`, no `fallbackReportedAt`) takes the normal path and never receives a stale notice.
- Records whose initiator never resumes stay pending until the next restart replaces them — the pre-existing identity checks (`exitAt` comparison in the timer and the persistence re-check) already cover the retirement; no other permanent-pending path exists.
- `fallbackGraceMs` default rises from 60000 to 300000 (five minutes); Config schema, JSDoc, and both READMEs moved together.

## Verification

`tests/self-restart-guard.spec.ts` (41 tests): the new cases cover fallback-does-not-settle, initiator-resume notice and settlement, no delivery to a third root in between, no stale notice after a record replacement, and the new grace default end-to-end (schema value plus fake-timer behavior). The four pre-existing fallback tests now assert pending-with-`fallbackReportedAt` instead of settlement. `tsc -b packages/guard/ankh-guard`, `oxlint`, and the translation-pairing and note-format gates pass.

## Alternatives considered

**Drop the fallback entirely and wait for the initiator forever.** A deleted session would then hold the record (and the report) forever; the fallback exists precisely so the report is never lost. Two-phase settlement keeps that property while restoring the initiator's notification.

**Let the fallback session relay to the initiator later.** Cross-session messaging does not exist in the harness; the record file is the only durable channel, so settlement state lives on it.

## Consequences

A restart report now reaches the initiator even when the fallback fired first: the other session gets the full report, the initiator gets the short notice on resume. A record can stay pending indefinitely when its initiator session was deleted; it is retired by the next restart. Deployments pick the change up on their next natural restart — the running instance was deliberately not restarted for this change.
