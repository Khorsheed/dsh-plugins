# Agent Note: schedule-exit takes the restart lock; pid-liveness consolidated

Status: implemented

English | [中文](2026-08-22-restart-lock-unify.zh.md)

## Problem

Two related defects in the restart mutual-exclusion design:

1. **A live cross-verb race.** `restart` holds `restart.lock` for its whole run; `schedule-exit` only *read* the lock and the marker without holding anything. The interleaving — schedule-exit checks marker (none) and lock (free) → restart acquires the lock, stops/starts the instance → schedule-exit writes its marker and spawns the exit agent → the agent SIGTERMs the instance the restart just started — is milliseconds wide but is exactly what a cross-session lock exists for.
2. **Triplicated pid-liveness logic.** `liveWatchdogPid`, `liveRestartLockHolder`, and `acquireRestartLock`'s internals each carried a copy of "read pid file, parse, `kill(pid, 0)`". The `pid > 0` guard (empty file → `kill(0, 0)` probes our own process group and always succeeds) had already needed fixing in two of the three copies separately.

## Decision

- `schedule-exit` now acquires `restart.lock` around its critical section (marker check → marker write → exit-agent spawn) and releases it in a `finally`. Both verbs serialize on the same primitive; a concurrent `restart` either holds the lock (schedule-exit refuses with the same "restart is in flight" wording) or completed before it. `restart`'s own marker check stays: it guards against an exit agent scheduled before its acquisition — already past the scheduling window.
- The liveness logic is one primitive: `pidAlive(raw)` (empty/dead → false) plus `livePidIn(file)`. `liveWatchdogPid` and the lock's reclaim path consume them; `liveRestartLockHolder` is deleted — the lock acquisition *is* the in-flight check now.

## Alternatives considered

- **Serializing on the marker instead of the lock** — the marker has TTL/stale semantics tied to the watchdog canary; the lock's live-holder discipline is the right primitive for in-flight exclusion.
- **Holding the lock across the credential/preflight gates** — those take seconds; the lock is held only across the millisecond critical section, so a failed gate never blocks a concurrent restart.

## Consequences

- `schedule-exit` while a restart is in flight refuses identically to before (same message), now enforced by acquisition rather than observation — the interleaving window is closed, not narrowed.
- New contract pinned by test: a completed schedule-exit leaves no `restart.lock` behind.
