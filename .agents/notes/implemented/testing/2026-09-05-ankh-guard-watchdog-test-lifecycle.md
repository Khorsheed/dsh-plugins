# Agent Note: Ankh Guard watchdog test lifecycle and gate partitioning

Status: implemented

[English](2026-09-05-ankh-guard-watchdog-test-lifecycle.md) | [中文](2026-09-05-ankh-guard-watchdog-test-lifecycle.zh.md)

## Problem

Ankh Guard's watchdog tests exercise real shells, detached supervisors, process groups, signals, listeners, takeover, rollback, authentication, and browser handoff. That realism exposed production defects, but the old fixture did not own its processes as rigorously as the production cutover protocol. Cleanup depended on the latest mutable `watchdog.pid`; a replaced or deleted pidfile could hide an earlier supervisor, successor, wrapper, listener, or crash page. A machine audit found 120 detached test groups containing 225 processes that had survived for roughly twenty minutes to seven days.

The same test file serialized production-sized sleeps. A package run took about 339 seconds, 338 seconds of which belonged to the watchdog file. Fixed ports also collided when gates from different worktrees ran on the same machine. The concurrent cutover-control test added a readiness race: it published a fake watchdog PID after a guessed delay and then cold-started twelve tsx writers. A traced failure showed an early `SIGUSR2` killing the fake process before its handler was installed; `kill(pid, 0)` still saw the unreaped zombie before all external writers later saw `ESRCH`.

Composition recovery had also failed intermittently in the full gate while passing in isolation. Evidence did not establish a product recovery defect, so the fixture needed better ownership, timing, and failure artifacts before any runtime recovery change.

## Decision

### Immutable process ownership and child-authored events

Every real-process test owns a private run ledger below a per-user, machine-wide directory in `$TMPDIR`. A process lease records role, PID, PGID, kernel-backed start token, run token, group-root status, temporary root, and expected port. Records are append-only; a successor adds an identity instead of replacing the previous one.

Direct spawns are registered immediately by the parent. In explicit test mode, CLI drivers, watchdogs, Bash instance wrappers, candidate probes, exit agents, proven listeners, and crash pages also self-register. The Bash registrar asks a short-lived Node helper for its real parent PID, which works on macOS Bash 3.2 where `BASHPID` is unavailable and `$$` still names the outer shell inside a background function.

The same test-only seam writes one JSONL event stream per subject process and observation source. Child-internal events such as handler installation and the first keepalive tick are written by the child. Parent spawn/exit/close callbacks and `ps` samples identify their source explicitly. Events carry wall and monotonic time and, while observable, PGID and start token. The seam is inert without both a private run directory and run token; it is not part of launch specs or production receipts.

### Identity-gated teardown and port evidence

`afterEach` first writes registered graceful stop markers, then performs identity-gated `TERM → bounded wait → KILL → bounded wait` over every lease in reverse order. A whole process group is signalled only while its registered group-root identity and current PGID still match. If that anchor is gone, teardown signals only matching registered members. It never sends a signal to a historical raw PID or PGID.

Temporary directories are removed only after process teardown. A failed test retains its run ledger. Teardown diagnostics include expected ports, stored and current identities, matching state, `ps` rows, watchdog log tails, malformed records, and the merged event timeline. Every registered port is checked after teardown; a remaining listener makes the test fail but never authorizes a port-selected kill.

Port allocation uses a mode-0700 per-user namespace shared across worktrees. The allocator binds an ephemeral loopback reservation before atomically creating the port lease, records every collision/retry, and reclaims an incumbent lease only when its owner identity is gone. A read-only `test:leaks` command separates reclaimable dead records, over-age live identities requiring human review, current live identities, and unreadable evidence. It never signals or removes a live identity.

### Readiness, timing, and test lanes

The fake control watchdog publishes its pidfile only after installing `SIGUSR2`, yielding through one keepalive tick, and writing a ready event. The twelve writers invoke the freshly built `lib/cli.js`; the test pins its SHA-256, still requires twelve zero exits, and separately requires durable `restore-previous` dominance. This replaces, rather than layers on, the interim `298375b` changes: that commit replaced the persist fixture's pre-pidfile 100 ms delay with a marker and separately enlarged the idles deadline.

The watchdog's internal polling and backoff use `wd_sleep`. Durations are unchanged in production. They scale to five percent only when the explicit test run coordinates and test scale are both present; a regression proves that the scale variable alone cannot shorten production behavior. Wall-clock cutover/stability deadlines remain real, so shortening polling does not bypass ownership or authentication windows.

Fixture observations use named predicate polling rather than assuming that a service response means its asynchronous report or receipt is already durable. Adoption, unplanned-exit, composition-snapshot/recovery, and browser terminal-state predicates have separate bounded budgets and emit the complete lifecycle ledger on timeout. A first dual-worktree stress run exposed the remaining 5–15 second report windows; these named waits replaced them before the acceptance run was repeated.

The package exposes `test:unit`, `test:integration`, and the umbrella `test`. Integration always builds first. The umbrella builds once and schedules both inventories together. Four isolated Vitest processes execute deterministically balanced supervisor shards, while machine-wide leases coordinate their ports. An inventory assertion prevents a name filter or shard change from silently dropping coverage: the current split is 54 unit tests and 128 integration tests, 182 total.

The integration runner prints CPU count, Node/package-manager versions, load average, external gate-process count, git HEAD, built CLI path, and SHA-256. Composition recovery now uses the common ledger and, on failure, reports its exact deadline, before/after composition hashes, repo HEAD, listener identity, receipt, watchdog log tail, and lifecycle timeline. Its stale-listener scenario releases from an explicit previous-attempt event rather than a wall-clock guess.

### Runtime control semantics remain separate

This change does not alter the product contract of `abort-cutover` or `restore-previous`. A bounded identity-aware discovery retry remains a separately reviewed runtime improvement. Persist-first queued control remains deferred because it needs explicit delivered-versus-queued status, TTL, successor identity validation, and status visibility.

## Verification

- The pre-change package/watchdog measurements were approximately 339/338 seconds.
- A complete integration run with no other gate process active passed 128/128 in 113.08 seconds on an 8-logical-CPU machine at load averages near 4.0.
- The unit lane passed 54/54 in about 9 seconds; the umbrella inventory requires 182 tests.
- The final package-level umbrella gate passed all 182/182 tests in about 115 seconds with zero external gate processes at its recorded baseline.
- Two independent `test:integration` commands running concurrently from separate worktrees then passed 128/128 each; their slowest supervisor shard was about 136 seconds under contention.
- The full integration run ended with zero active or over-age live identities in the machine lease report.
- Regressions cover detached group cleanup, TERM-to-KILL escalation, macOS Bash background-function identity, unscaled production sleep, dead-versus-over-age reporting, and independent machine-namespace port leases.
- The control-writer, composition-recovery, stale-200/EADDRINUSE, foreground-waiter, and pidfile-replacement cases pass with the new ledger.

## Alternatives considered

**Only increase Vitest timeouts.** Rejected because it would not reclaim leaked processes, close the readiness race, prevent cross-worktree port collision, or reduce the six-minute feedback loop.

**Keep cleanup based on the latest pidfile or current port owner.** Rejected because both are mutable observations. A port proves a leak but cannot authorize a signal, and takeover intentionally replaces pidfile ownership.

**Always kill the remembered process group.** Rejected because a PGID has no start identity. Group signalling requires a still-matching registered anchor; otherwise only exact registered members are eligible.

**Mock every watchdog path.** Rejected because shell detachment, signal delivery, reparenting, PID identity, and listener handoff have found defects that pure state tests cannot represent.

**Ignore writer exit codes and assert only the final marker.** Rejected under the current refusal contract. Once readiness is real, a refused writer is useful evidence; marker dominance remains a separate correctness assertion.

**Queue emergency controls when no watchdog is live.** Deferred because an unconsumed stale abort can be more dangerous than a loud refusal without a TTL and successor-consumption contract.

## Consequences

Real-watchdog coverage remains mandatory while the package gate becomes bounded enough for routine use. Failures retain durable, source-labelled evidence, and teardown fails closed instead of risking another worktree or production instance. The cost is additional internal test-only code in the built package, a machine lease directory that requires occasional read-only audit, and a maintained shard inventory. New tests must update the explicit lane count, and unusually long supervisor cases may need a deliberate shard rebalance.

The 113-second run is a successful target run, not a three-run statistical median. Future performance audits should compare declared no-external-gate windows and retain the emitted load metadata. Shared CI workflow changes remain with the mainline owner; existing CI already reaches both lanes through the package's umbrella `test` command.
