# Agent Note: watchdog port ownership — atomic pidfile claim, port-mismatch diagnosis, bounded EADDRINUSE retry

Status: implemented

English | [中文](2026-08-18-watchdog-port-ownership-and-atomic-claim.zh.md)

## Problem

Three defects, all reachable from a start command that does not bind the supervised port — the failure that cost a clean-environment install three restart attempts (the instance bound the application default 3080 while supervision watched 8766).

1. **The singleton claim was a TOCTOU window.** `[ -f "$PIDFILE" ] && kill -0` followed by `echo $$ > "$PIDFILE"` is check-then-write: watchdogs starting together all fail the liveness test before any of them writes, and every one of them proceeds. Eight racers against one `WD_HOME` left two supervisors on one port.
2. **A boot-window timeout could not distinguish "never started" from "started on the wrong port."** The watchdog polls `:$PORT` for 60 s, reports `instance failed to come up`, and at failure #2 rolls the repository back to the last known-good revision. A start command missing its port flag is a command-line argument, not a code regression, so the rollback discards good commits for a typo the reset cannot reach.
3. **`EADDRINUSE` anywhere in the attempt log took the port-race escape hatch.** The branch matched the string without checking which port it named, then announced the supervised port, called `free_port` on the supervised port, and `continue`d without incrementing `failures`. A start command aimed at an occupied *foreign* port therefore respawned the instance in a tight loop with no backoff, no give-up, and no crash page — measured at 24 respawns in 25 s with the failure counter still at 0.

## Decision

1. **Atomic claim.** `(set -C; echo $$ > "$PIDFILE")` — noclobber makes the redirect itself fail when the file exists, so exactly one racer creates it. A loser reads the owner: alive means exit; a dead pid means drop the pidfile and race again. An EMPTY file is a rival's claim mid-write — the noclobber create and the echo are two disk operations, and a preempted winner sits between them — so a loser that reads empty waits a beat and re-reads instead of deleting, dropping the file only after several consecutive empty reads (an abandoned mid-write); deleting on first empty read re-opens the race and can cascade every racer into exhausting its attempts (observed 2026-08-29 under deploy-gate load: eight racers, zero survivors). Bounded at five real attempts. The claim runs before the cleanup trap is installed, so a loser cannot delete the winner's pidfile on its way out.
2. **Name the port mismatch.** On a boot-window timeout the watchdog reads the child tree's listening ports (`pid_tree` + `lsof`) *before* reaping it — afterwards the evidence is gone. Listening somewhere other than `:$PORT` prints the bound port next to the supervised one and sets `reset_done`, the same escape hatch a failure whose subject lives outside the repository already uses: the rollback is marked spent, while `failures` keeps counting toward the crash page that makes the misconfiguration visible.
3. **Port-aware, bounded EADDRINUSE.** The escape hatch now applies only when the conflict names `:$PORT`, and only for five attempts — past that the port has an owner this watchdog cannot free, which is a boot failure, not a race. A conflict on any other port is reported as a start-command error and counted.

`WD_BOOT_TIMEOUT` (default 60) joins the documented `WD_*` environment contract so these paths are testable without spending a full boot window per attempt.

## Verification

- `bash -n` clean. Race harness, eight concurrent watchdogs against one `WD_HOME`: two surviving supervisors before, one after.
- End-to-end against a start command bound to the wrong port, old script vs new. Target port free: 18 respawns / 1 counted failure / no diagnosis → 3 respawns / 3 counted failures / diagnosis emitted. Target port occupied: 24 respawns / **0** counted failures (unbounded spin) → 3 respawns / 3 counted failures / diagnosis emitted. No rollback fired in either new-script run.
- `tests/self-restart-guard.spec.ts` gains two cases, each confirmed to fail against the pre-fix script and pass after: `claims the pidfile atomically` (asserts one survivor of eight racers, and that the pidfile names it) and `counts an EADDRINUSE on a foreign port as a boot failure instead of retrying forever` (asserts the diagnosis, that failures are counted, that attempts stay in single digits, and that the rollback stays unspent). The first attempt at the race case passed against both scripts — spawning racers one at a time from node staggers them past the window — so it launches them from a single shell instead, and settles on a stable survivor count rather than the first reading of 1, which the launcher's own fork window can produce.
- The pre-existing `treats EADDRINUSE as a port race` case carried no explicit timeout while waiting on a 20 s deadline, so vitest's 5 s default bounded it; six spawn-and-fail cycles do not fit. It failed identically against the pre-fix script (3/3), and now declares 30 s like its siblings.
- Full suite 68/68 on two consecutive runs; `typecheck` passes.
- 2026-08-29 follow-up: the eight-racer case flaked under a four-package deploy gate (zero survivors) via the empty-read cascade now closed above, and the reclaim case's 10 s windows sat below one loaded supervise-loop iteration (~6 s unloaded in fake-instance mode: spawn + health poll + two sleeps), so the reclaim/yield windows were widened to 25 s. The cascade did not reproduce in a 60-round local stress (unloaded, `yes`-saturated, and suite-concurrent runs all clean) — the window is closed by construction, not by measurement.

## Alternatives considered

**A lock directory (`mkdir`) instead of noclobber.** `mkdir` is equally atomic but splits the owner pid into a second file, which reintroduces a window between the lock and the pid it is supposed to identify. The pidfile is already the published interface (the CLI, the installer, and the test cleanup all read it), so making its creation atomic keeps one artifact.

**Refusing to start when `--start` omits the port.** The watchdog cannot parse an arbitrary shell command for a port it may pass by environment variable, config file, or default. Observing what the instance actually bound is the only reading that holds for every start command.

**Treating a port mismatch as a hard exit.** Exiting leaves the port unsupervised, which is the shape this whole design removes. Counting toward the crash page keeps the watchdog alive and puts the diagnosis on the port the operator is already looking at.

## Consequences

A start command that misses the supervised port now produces a named diagnosis and a crash page within four failures instead of a silent 60 s timeout followed by a repository rollback, and one aimed at an occupied foreign port terminates instead of spinning. Concurrent `supervise` invocations against one `WD_HOME` can no longer both win. The rollback stays reserved for failures a checkout reset can actually fix.

**Ambient WD_* isolation (2026-08-29).** The watchdog spawns the instance with its own `WD_*` environment still set, so every shell inside a supervised instance — including every agent session's test runner — carries `WD_STATE_DIR`, `WD_PORT`, and friends. The two direct-spawn supervise cases spread `process.env` unscrubbed, and the script honors a leaked `WD_STATE_DIR` over the test's `WD_HOME`: an agent running the suite inside the supervised 3080 deployment sent the test watchdogs into the PROD state dir, where the live watchdog holds the pidfile — the race case yielded zero survivors in ~3 s and the reclaim case never saw its temp pidfile (deadline at 15 s). Both signatures were reproduced exactly by pointing `WD_STATE_DIR` at a live-occupied directory, and both pass under the same leak once the spawned env strips `WD_*` (`watchdogEnv` in the spec). Machine load was never the cause.
