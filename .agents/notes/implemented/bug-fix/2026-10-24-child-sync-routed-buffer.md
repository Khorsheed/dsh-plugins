# Agent Note: Child-session sync no longer double-writes the routed live buffer

Status: implemented

English | [中文](2026-10-24-child-sync-routed-buffer.zh.md)

## Problem

A CLI member's mode tools failed on every call with `append seq mismatch for "<child>": expected 19 at index 0, got 9`. The failure appeared even for a read-only `game_open`.

While local-agent holds a child session's write handle, the host routes every live append into that writer's buffer (`session-persistence-jsonl` `enqueueLive`), which drains on a 200 ms timer or on `session/flush`. `syncChildSession` also appended `snapshotEvents().slice(stored.length)` explicitly after every mirrored round. Events still sitting in the buffer were missing from `stored`, so they were written twice. The explicit write landed first, and the buffered copy then failed contiguity. A failed drain keeps its batch and pauses the timer, so the buffer stayed poisoned for the handle's lifetime. The log on disk stayed complete. The host's `tools/execute` checkpoint runs `sessions.flush` before a tool runs, so every mode tool the member called hit the poisoned drain.

## Decision

`syncChildSession` first drains what the host routed (`sessions.flush(session)`). It then appends only what is still missing, bounded to the events that existed before the drain: events from before the handle opened, or a host that routes nothing. If a sync meets an `append seq mismatch`, it releases the handle together with its poisoned buffer and catches up from disk on a fresh handle.

## Alternatives considered

**Explicitly append only once per handle, then rely on flush.** Rejected: it needs per-handle bookkeeping across the reattach and create paths. The drain-then-fill pass converges to the same writes and also covers a host that routes nothing.

**Avoid the host checkpoint flush in the preset tool host.** Rejected: that only hides the symptom. The poisoned buffer would still fail at dispose, and it would still fail the next flush anyone triggers.

## Consequences

- `room/tests/member-stream-persistence.host.spec.ts` runs against the real JSONL backend. It now lets the routed timer fire, then flushes. Before this fix it reproduces the production error; after it, it passes.
- A handle already poisoned in a running instance heals at its next sync.
