# Agent Note: video-studio — retrying a failed job reuses its row

Status: implemented

## Problem

Retrying a failed transcription stacked a fresh row each click: `retryTranscribe` went through `enqueue`, which only deduped `queued` jobs, so a failed job plus two retries rendered as three identical failure cards in the project's task list.

## Decision

`enqueue` now treats a `failed` job with the same project, kind, and payload as the thing being enqueued: it resets that record to `queued` (progress 0, error cleared, label refreshed, `updatedAt` bumped) and pumps, instead of appending. This covers the retry button and the auto-transcribe path after a failed first attempt alike, and cancelled jobs (state `failed`, error 已取消) retry in place too. Jobs are task state, not an audit trail — there is nothing to preserve in a superseded failure row beyond its message, which the retry answers.

## Alternatives considered

- **Collapse duplicates only in the UI**: rejected — the noise would still persist in `jobs.json` and accumulate forever.
- **Keep history by marking the old row superseded**: rejected — no surface reads that history; one row per pending intention is the model the UI already implies.

## Consequences

- Task lists stay single-row per intention; the failed error message disappears when the retry starts (it is stale by definition at that point).
- Job `createdAt` survives the retry (the row keeps its original position); `updatedAt` reflects the retry.

## Testing

`tests/core.spec.ts` seeds a failed export job and asserts the re-enqueue returns the same id with the jobs file still holding one entry. Package suite 29/29 green.
