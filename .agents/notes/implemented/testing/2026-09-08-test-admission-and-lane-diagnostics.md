# Agent Note: Machine test admission and per-task lane diagnostics

Status: implemented

[English](2026-09-08-test-admission-and-lane-diagnostics.md) | [中文](2026-09-08-test-admission-and-lane-diagnostics.zh.md)

## Problem

Concurrent worktree gates reported Ankh Guard inventories of 178 or 163 against 190. The passing-only expression `/Tests\s+(\d+) passed/` cannot read Vitest's failure-first summary `Tests 1 failed | 11 passed | 128 skipped (140)`: it loses the whole twelve-test shard, not just the failed test. Inspection of Vitest's installed formatter and a regression establish this aggregation defect. They do not establish which tests failed in the historical runs, or prove resource exhaustion, OOM, or skipped tests caused those failures; the original per-task artifacts were not supplied. The gate also deleted its tee log even after failure.

Four-way concurrency inside each lane does not bound simultaneous lanes from different worktrees, and Vitest can add worker parallelism inside each child. Separately, gate removed the root package from its displayed directory list but still executed the unmodified selector. When root and a real package were selected together, root's recursive build/test scripts could escape the intended package closure. Docs-only root selection already resolved to no packages; not every documentation edit reproduced the recursion.

## Decision

### Structured results, no hidden retry

Each lane task writes a Vitest JSON report and stdout/stderr directly to separate mode-0600 files inside a private OS temporary directory. The runner waits for `close`, handles spawn errors, validates the report, and checks an explicit passing inventory per task. It reports passed, failed, skipped, todo, missing passing count, exit code, signal, failed test names/messages, and artifact paths. Missing or inconsistent JSON, suite errors, nonzero exits, signals, and count mismatches all fail closed. Deliberate name-filter and static-shard skips are visible but do not count as passes.

The final `summary.json` includes the start/end load average, external test-process count, git HEAD, built CLI path/hash, task outcomes, and infrastructure errors. All launched workers settle before the admission is released, including on an infrastructure exception. Raw logs and JSON remain available even for passing runs; the OS temporary-directory lifecycle owns retention, not the process lease reclaimer. Gate keeps its own tee log on failure. There is no automatic retry or changed passing threshold.

The first instrumented umbrella run passed all 194 assertions but exited nonzero in `lifecycle-drift`: Vitest reported `[vitest-worker]: Timeout calling "onTaskUpdate"`. The real-home cyclic-link test occupied a synchronous body for 71.2 seconds. This is direct evidence of a runner/RPC failure, distinct from the historical missing-pass reports. That test now awaits bounded asynchronous CLI/install/probe subprocesses, runs the synchronous snapshot implementation from the freshly built output in a bounded worker thread, and awaits asynchronous large-tree cleanup. The worker must exit after returning its snapshot coordinates; the same graph-containment and unchanged-live-byte assertions remain. The product snapshot implementation and Vitest RPC timeout are unchanged.

### Two bounded admissions

`test-resource.mjs` is internal test tooling, not a published runtime entry. Both root gate and the standalone Ankh Guard lane use it, avoiding a mirror dependency on root tooling. Separate `gate` and `ankh-integration` resources live in the same private, per-user OS temporary namespace across checkouts. New gates serialize against each other; integration and umbrella lanes serialize against each other. Lock ordering is gate first, integration second. Each Vitest lane child has exactly one worker; a lane schedules at most four tasks (two for unit).

An exclusive-create lock records PID, random ownership token, cwd, and creation time. Waiters report the owner and elapsed time every fifteen seconds and fail after twenty minutes. This is bounded polling for availability, not a fixed delay before execution. An exited owner or unreadable/stuck record does not authorize automatic reclamation or any signal: descendants may still exist. The caller releases only its matching token after its work has settled. Abnormal termination retains the lock for inspection; there is deliberately no exit hook that could release while detached descendants survive. PID reuse can only delay/refuse admission, never authorize killing a process. The isolated test injects the root through a function parameter, not a production environment switch.

Admission is cooperative: older checkouts, standalone builds, direct Vitest invocations and unrelated workloads do not participate. It reduces nested gate competition but is not a global CPU/RAM scheduler or a promise that load cannot cause failure. Evidence, not `loadavg` alone, determines the diagnosis.

### Scope and runtime boundaries

The same root-excluding filter is used for selection, build and test. Dependency closure and shared-path full fallback remain intact. Selected Ankh Guard still runs its complete umbrella suite; full gate and CI retain both lanes. Unrelated changes no longer reach it through root recursion. We do not downgrade shared-layer verification to unit-only.

No production cutover, checkpoint, timeout, profile or host source changes are included. The reported recent checkpoint message matches an explicit call in `profiles/web-eval/scripts/restart-into-web-eval.sh`, which resolves a profile-installed CLI. Current clean-tree checkpoint records the existing HEAD and dirty checkpoint requires explicit `--include-dirty`; the watchdog does not create checkpoint commits. The empty historical commit alone cannot identify the executing artifact. This is an installed-artifact/caller audit boundary, not evidence to add another watchdog commit policy.

## Alternatives considered

**Retry an incomplete shard automatically.** Rejected: an assertion failure itself made the old parser lose the shard. Retrying it would conflate a real failure with an observation error and could turn a useful red signal green.

**Only increase timeouts or reduce concurrency when `ps` looks busy.** Rejected as the coordination mechanism: simultaneous entrants can both observe idle, and process names/load are not ownership. Explicit cooperative admission bounds participating runs; diagnostics still expose nonparticipants.

**Move integration out of ordinary gate or reduce the expected count.** Rejected because that removes the process/ownership coverage that found real defects. Root exclusion fixes scope without removing selected coverage.

**Automatically reclaim a dead admission owner.** Rejected for now: owner death does not prove its detached descendants settled. Automatic recovery needs descendant ownership evidence, not a stale PID heuristic.

## Consequences

Concurrent agents trade some queue latency for fewer overlapping heavy test runs and actionable failure evidence. The per-task inventory remains maintenance work when tests move. A crashed gate may require human inspection of the retained lock and its children; normal failure releases admission after synchronous commands and lane workers finish. No process is killed by admission, and resource contention never becomes a silent test skip. Cross-process ACK tests establish acquire → busy → release → acquire without sleeping to guess overlap; structured-result tests pin failure-first summaries, signals, missing reports and inventory inconsistencies. This extends, without changing production semantics, the [lifecycle ownership design](2026-09-05-ankh-guard-watchdog-test-lifecycle.md).
