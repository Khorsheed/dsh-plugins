# Agent Note: Reattach waits for a recovering child-session writer

Status: implemented

## Problem

The restart continuation case in `packages/local-agent/tests/run-entry.spec.ts` failed on Linux CI with `SessionAlreadyOwnedError: session "member-r" is already owned by an active write handle`, while the complete package suite passed on macOS.

A suffix-sync failure takes the recovery path in `syncChildSessionWithRecovery`: it releases the cached write handle and retries from disk. `resumeStaged` can reattach the same child while that close is still settling. The handle trace showed the recovering sync open, its close begin, the reattach open begin, and only then the earlier close finish. Linux treats independently opened descriptions as competing owners, so the second open fails even within one process. The same sequence passing on macOS does not make it a valid lifecycle.

This is not a stale lock left by a dead process, and the host's `SessionWriteLease` is enforcing the correct single-writer rule. `packages/local-agent/src/index.ts` allowed two of its own operations to overlap the close and the next open.

## Decision

The registry tracks a pending release promise per child in `childWriteHandleReleases`. `releaseChildWriteHandle` removes the cached handle and keeps its close promise visible until that close settles. Every later `acquireChildWriteHandle` awaits the pending release before it can stat, create, or open the session. Concurrent acquirers still share one promise from the existing cache.

Plugin disposal goes through the same release helper and then awaits any outstanding releases. This makes the close itself the serialization point instead of relying on one caller to wait for a global sync set. Reattach does not wait for unrelated children's sync work.

There is no lock retry, timeout, lock-file deletion, or relaxation of single-writer ownership. The test fixture disposes the local-agent fiber before the rest of its Cordis context, so execution-end records are written before the session store unloads; that fixture cleanup alone does not solve the runtime race.

## Alternatives considered

- **Wait only for `childSyncs` at reattach.** Rejected after repeated Linux CI failures: not every close/acquisition is represented by that set, so the close can still overlap the next open. The pending release, not the caller, must be the shared ordering primitive.
- **Retry the acquisition or treat contention as transient.** Rejected: the two owners are operations in the same registry, and the close/open ordering is the actual defect. A retry hides that lifecycle error and does not protect the log from other ordering mistakes.
- **Delete or forcibly take the lock.** Rejected: the lock is live and correct. Removing the file would defeat the inode ownership check and could admit a genuinely concurrent writer.
- **Dispose the whole test context and leave production unchanged.** Rejected as insufficient: the Linux failure persisted with complete fixture teardown. Disposal order still matters for retaining execution-end records, but it cannot serialize a later sync recovery with reattach.
- **Skip the restart case on Linux.** Rejected: the failure identifies a real resume defect on a supported platform, not an optional platform feature.

## Consequences

A new write for one child cannot begin until the previous close for that same child has settled. Unrelated members do not block one another through a registry-wide wait. The single-writer guarantee and genuine cross-process contention errors remain intact, with no data migration or configuration change.

## Testing

`packages/local-agent/tests/child-session-sync.spec.ts` now holds the previous close open with a test gate. It proves that a second acquisition does not call `open` before the gate resolves, that concurrent acquirers share the same promise, and that the release record is removed afterward. The focused child-sync and restart-entry suites passed: 12 + 9 tests.

The existing restart continuation case still exercises the recovering sync followed by reattach. The complete local package suite passed: 59 files, 598 tests, including the deterministic close/acquisition gate. Linux CI remains a required release check.

## Related

- [One mirror-step writer for the local-agent providers](../simplification/2026-11-02-local-agent-shared-mirror-writer.md)
- [A kimi member recovers from a session lock its dead process left behind](2026-11-04-kimi-stale-session-lock.md)
