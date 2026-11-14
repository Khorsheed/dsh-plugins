# Agent Note: Reattach waits for a recovering child-session writer

Status: implemented

## Problem

The restart continuation case in `packages/local-agent/tests/run-entry.spec.ts` failed on Linux CI with `SessionAlreadyOwnedError: session "member-r" is already owned by an active write handle`, while the complete package suite passed on macOS.

A suffix-sync failure takes the recovery path in `syncChildSessionWithRecovery`: it releases the cached write handle and retries from disk. `resumeStaged` can reattach the same child while that close is still settling. The handle trace showed the recovering sync open, its close begin, the reattach open begin, and only then the earlier close finish. Linux treats independently opened descriptions as competing owners, so the second open fails even within one process. The same sequence passing on macOS does not make it a valid lifecycle.

This is not a stale lock left by a dead process, and the host's `SessionWriteLease` is enforcing the correct single-writer rule. `packages/local-agent/src/index.ts` allowed two of its own operations to overlap the close and the next open.

## Decision

`reattachChildSession` waits for the registry's active `childSyncs` to settle before calling `acquireChildWriteHandle`, using the same quiescence condition as plugin disposal. The previous write handle finishes closing before reattach can acquire a new one.

The existing cache, suffix-sync recovery, and reattach behavior otherwise stay unchanged. There is no lock retry, timeout, lock-file deletion, or relaxation of single-writer ownership. The test fixture disposes the local-agent fiber before the rest of its Cordis context, so execution-end records are written before the session store unloads; that fixture cleanup alone does not solve the runtime race.

## Alternatives considered

- **Retry the acquisition or treat contention as transient.** Rejected: the two owners are operations in the same registry, and the close/open ordering is the actual defect. A retry hides that lifecycle error and does not protect the log from other ordering mistakes.
- **Delete or forcibly take the lock.** Rejected: the lock is live and correct. Removing the file would defeat the inode ownership check and could admit a genuinely concurrent writer.
- **Dispose the whole test context and leave production unchanged.** Rejected as insufficient: the Linux failure persisted with complete fixture teardown. Disposal order still matters for retaining execution-end records, but it cannot serialize a later sync recovery with reattach.
- **Skip the restart case on Linux.** Rejected: the failure identifies a real resume defect on a supported platform, not an optional platform feature.

## Consequences

A resume no longer competes with the recovering writer's close. The single-writer guarantee and genuine cross-process contention errors remain intact, with no data migration or configuration change.

Reattachment can wait for sync work belonging to other children as well as its own, because `childSyncs` is a registry-wide set. That is the same bounded coordination already used at disposal; it is not a new background queue or persistent lock.

## Testing

The existing restart continuation case exercises the recovering sync followed by reattach. A temporary instrumented run showed the first handle's close completing before the reattach open, and the focused nine-test file passed with that ordering; the instrumentation was removed before committing. The original Linux CI failure provides the cross-platform regression signal.

The complete local package suite passed: 59 files, 597 tests. In [Linux CI](https://github.com/Khorsheed/dsh-plugins/actions/runs/43563981827), those same 59 files and 597 tests also passed; this package-level result does not imply that the whole repository job passed.

## Related

- [One mirror-step writer for the local-agent providers](../simplification/2026-11-02-local-agent-shared-mirror-writer.md)
- [A kimi member recovers from a session lock its dead process left behind](2026-11-04-kimi-stale-session-lock.md)
