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

Port allocation uses a mode-0700 per-user namespace shared across worktrees. The allocator binds an ephemeral loopback reservation before atomically creating the port lease, records every collision/retry, and reclaims an incumbent lease only when its owner identity is gone. `test:leaks` is read-only by default and separates reclaimable dead records, over-age live identities requiring human review, current live identities, and unreadable evidence. Its explicit `--reclaim` mode takes an identity-owned machine lock and removes only complete runs whose owner and every registered process identity are gone, their dead port-lease files, and their referenced, current-user `mkdtemp` roots beneath the real OS temp directory. Removal never selects or signals a process by port. Mixed-live, malformed, path-escaping, symlinked, or concurrently changing evidence remains untouched. Preflight snapshots carry a creator identity marker so an orphaned snapshot can meet the same proof; legacy unmarked snapshots remain human-review evidence.

The integration and umbrella package entries run the same reclaimer with a 24-hour minimum age before starting workers. This is intentionally a retention window rather than immediate teardown: recent failed-run evidence remains available for diagnosis, while old identity-proven sandboxes no longer accumulate indefinitely. Operators can request immediate proven-dead cleanup with `pnpm test:leaks -- --reclaim`; the summary records category counts, while JSON records every removed, skipped, and failed path. Reclaim is serialized across worktrees and never weakens ordinary per-test teardown.

The destructive reclaim semantics spec uses an internal-only scope parameter for both its lease root and temporary-artifact base. It therefore proves identity, age, path-containment, snapshot-marker, and live-owner rules without assuming that the real machine-wide reclaim lock is idle. The operator-facing script does not expose this override and continues to call the production wrapper without arguments, so its per-user `$TMPDIR` root and `busy` result are unchanged. Mutual exclusion has a separate cross-process regression: a child acquires the real lock primitive through a test-only adapter and acknowledges ownership, the parent observes `busy`, the child acknowledges release, and the parent then observes `acquired`. No sleep establishes the overlap.

### Readiness, timing, and test lanes

The fake control watchdog publishes its pidfile only after installing `SIGUSR2`, yielding through one keepalive tick, and writing a ready event. The twelve writers invoke the freshly built `lib/cli.js`; the test pins its SHA-256, still requires twelve zero exits, and separately requires durable `restore-previous` dominance. This replaces, rather than layers on, the interim `298375b` changes: that commit replaced the persist fixture's pre-pidfile 100 ms delay with a marker and separately enlarged the idles deadline.

The watchdog's internal polling and backoff use `wd_sleep`. Durations are unchanged in production. They scale to five percent only when the explicit test run coordinates and test scale are both present; a regression proves that the scale variable alone cannot shorten production behavior. Wall-clock cutover/stability deadlines remain real, so shortening polling does not bypass ownership or authentication windows.

Fixture observations use named predicate polling rather than assuming that a service response means its asynchronous report or receipt is already durable. Adoption, unplanned-exit, composition-snapshot/recovery, and browser terminal-state predicates have separate bounded budgets and emit the complete lifecycle ledger on timeout. A first dual-worktree stress run exposed the remaining 5–15 second report windows; these named waits replaced them before the acceptance run was repeated.

The four transition-line terminal predicates—successful supervision transfer, hung-previous recovery, failed-target reconfigure recovery, and live-home transition rollback—use named 60-second observation budgets; the recovery cases have 90-second Vitest envelopes and successful transfer has 120 seconds because it first proves the previous watchdog completed a healthy boot. The hung-previous fixture also gives the replacement 30 seconds to reach its explicit bounded-yield log before sending restore; the watchdog's tested yield remains exactly 3 seconds. Loaded gates had reached correct intermediate `target-starting` or `restoring` states near the former 20–35 second limits, and one loaded run took 11 seconds merely to claim supervision and enter the yield phase. A retained successful-transfer failure showed the target listener registered at 21.4 seconds, ownership stability at 29.5 seconds, and another receipt writer running at 33.0 seconds; the old 25-second fixture observation budget expired while the transaction was still making forward progress. `target-starting` intentionally spans child start, transport, ownership stability, canary, and terminal-ready persistence, so its `updatedAt` is not time spent without progress. These are fixture observation budgets only: they do not scale or alter the watchdog's production cutover, ownership-stability, authentication, or recovery deadlines.

The package exposes `test:unit`, `test:integration`, and the umbrella `test`. Integration always builds first. The umbrella builds once and schedules both inventories together. Up to four isolated, single-worker Vitest processes execute deterministically balanced supervisor shards, while machine-wide leases coordinate their ports. An inventory assertion prevents a name filter or shard change from silently dropping coverage: the current split is 64 unit tests and 130 integration tests, 194 total. Per-task JSON results and cross-worktree admission are owned by the [test admission and diagnostics note](2026-09-08-test-admission-and-lane-diagnostics.md).

The lane runner consumes a shard only after the child `close` event, not `exit`, because `exit` can precede the final stdout/stderr pipe reads. Spawn errors are reported explicitly. This closes a high-load observation in which one run saw only 161/182 tests because the final 21-test summary was absent; the inventory tripwire correctly rejected that incomplete observation instead of reporting false success.

Every Vitest child launched by the lane runner receives the repository's 30-second default test budget. Ankh Guard deliberately has no monorepo `vitest.config.ts`: its public mirror owns a standalone config that the mirror synchronizer preserves, then would overwrite if the monorepo began shipping a file at the same path. The runner-level budget therefore covers future spawn-heavy cases without changing mirror ownership; lifecycle cases that need 45 or 90 seconds retain their explicit budgets. This became necessary when the real-tarball pack smoke grew past Vitest's five-second default under whole-repository load.

The hung-previous takeover fixture establishes its precondition before a successor can retire the previous watchdog: it freezes the captured previous identity, revalidates that identity after `SIGSTOP`, and resumes a mismatched PID instead of leaving an unrelated process stopped. The previous host child remains live while the successor claims supervision, waits its bounded yield, consumes restore, and force-retires the frozen identity. The earlier fixture sent a raw-PID `SIGSTOP` after starting the successor; its 200-millisecond grace was not a synchronization barrier, so a correctly fast successor could retire the previous watchdog first and make the test throw `ESRCH` without exercising the intended scenario.

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
- Reclaim coverage proves that an old fully dead run, its port lease, its nested temp root, and an identity-marked orphan snapshot are removed, while an old live-owner run and port lease, an external path and its bytes, and a legacy unmarked snapshot survive unchanged.
- The control-writer, composition-recovery, stale-200/EADDRINUSE, foreground-waiter, and pidfile-replacement cases pass with the new ledger.
- The successful-transfer, hung-previous, failed-target reconfigure, and live-home transition cases retain their terminal receipt assertions with load-tolerant named polling; an intermediate phase at timeout remains a loud failure with lifecycle diagnostics.
- After the follow-up, unit passed 54/54, integration passed 128/128, and the concurrent umbrella passed 182/182. The pack smoke completed inside the runner budget, and the deterministic hung-previous case passed in both the integration-only and umbrella runs. The final leak report again had zero active, over-age-live, or unreadable records.
- After adding the missing successful-transfer steady-state barrier and named terminal wait, three consecutive integration runs passed 128/128; the transfer case completed in 24.6, 22.0, and 21.0 seconds. A subsequent package umbrella run passed 182/182 with the transfer case at 23.3 seconds and the slowest supervisor shard at 128.3 seconds under a recorded one-minute load average near 8.0.
- The isolated reclaim semantics and deterministic child/parent lock handshake passed together in the lifecycle shard. The full integration inventory then passed 130/130 before the dual-worktree acceptance run.
- Two independent worktrees at commit `9a42152` then ran the complete integration lane concurrently and both passed 130/130. Both lifecycle shards passed the isolated reclaim semantics, acknowledged cross-process mutex, and hung-previous coverage. The final machine report contained 490 reclaimable historical records and zero active-live, over-age-live, or unreadable records.

## Alternatives considered

**Use larger Vitest timeouts as the lifecycle fix.** Rejected because it would not reclaim leaked processes, close the readiness race, prevent cross-worktree port collision, or reduce the six-minute feedback loop. After those mechanisms were implemented, matching the repository's 30-second default in the package runner was still appropriate for the independent pack-smoke budget gap.

**Add a monorepo `vitest.config.ts` to Ankh Guard.** Rejected because the public mirror owns a standalone file at that path. The mirror sync keep set protects it from the initial wipe, but a tracked monorepo file would subsequently copy over it. A runner-level default changes only the missing timeout policy and leaves the mirror's resolution configuration independent.

**Catch `ESRCH` or enlarge the post-reconfigure sleep.** Rejected because either approach can let the hung-watchdog test pass without ever establishing a hung previous identity. The fixture sets up and proves the precondition before the successor starts instead of making a scheduling window wider.

**Scale the product wall-clock cutover and stability deadlines in tests.** Rejected because those windows are part of the ownership and authentication protocol being exercised. Only the fixture's outer observation allowance is wider for the three demonstrated loaded-gate paths.

**Keep cleanup based on the latest pidfile or current port owner.** Rejected because both are mutable observations. A port proves a leak but cannot authorize a signal, and takeover intentionally replaces pidfile ownership.

**Delete every old `guard-*` or `ankh-*` directory under the temp directory.** Rejected because a name and age do not prove ownership. Run-linked roots require a fully dead identity ledger; standalone preflight snapshots require their creator-authored identity marker. Unmarked historical directories remain visible but are never guessed safe.

**Retry the destructive semantics spec until the real machine-wide lock becomes free.** Rejected because another worktree legitimately owns that lock, and an open-ended wait would couple otherwise independent gates. A private filesystem scope tests reclaim rules; a separate acknowledged cross-process fixture tests contention.

**Select the reclaim scope through an ordinary environment variable.** Rejected because an ambient variable could accidentally change an operator cleanup. The override is an internal function argument used only by tests, while the script always uses the default scope.

**Always kill the remembered process group.** Rejected because a PGID has no start identity. Group signalling requires a still-matching registered anchor; otherwise only exact registered members are eligible.

**Mock every watchdog path.** Rejected because shell detachment, signal delivery, reparenting, PID identity, and listener handoff have found defects that pure state tests cannot represent.

**Ignore writer exit codes and assert only the final marker.** Rejected under the current refusal contract. Once readiness is real, a refused writer is useful evidence; marker dominance remains a separate correctness assertion.

**Queue emergency controls when no watchdog is live.** Deferred because an unconsumed stale abort can be more dangerous than a loud refusal without a TTL and successor-consumption contract.

## Consequences

Real-watchdog coverage remains mandatory while the package gate becomes bounded enough for routine use. Failures retain durable, source-labelled evidence, and teardown fails closed instead of risking another worktree or production instance. Identity-proven dead evidence ages out automatically after 24 hours; over-age live identities, malformed evidence, unsafe paths, and legacy unmarked snapshots still require read-only audit and a human decision. The cost is additional internal test-only code, including a scoped reclaim adapter and lock-holder fixture, a creator marker in preflight snapshot roots, and a maintained shard inventory. New tests must update the explicit lane count, and unusually long supervisor cases may need a deliberate shard rebalance. An unannotated hung test now takes up to 30 seconds rather than five to fail, matching the repository preset; explicit lifecycle budgets remain the authority when they are larger.

The 113-second run is a successful target run, not a three-run statistical median. Future performance audits should compare declared no-external-gate windows and retain the emitted load metadata. Shared CI workflow changes remain with the mainline owner; existing CI already reaches both lanes through the package's umbrella `test` command.

One heavy-contention fixture race remains recorded for M4 follow-up: with all four shards saturated while `test:leaks` also ran, the stale-200/EADDRINUSE recovery reached terminal `restored` but observed `failureCount.previous = 0` rather than the expected `1` after its full 35-second budget. This is a failure-count attribution window, not another timeout or an observed production recovery failure; the lifecycle diagnostics now preserve enough evidence to investigate it without weakening the assertion.
