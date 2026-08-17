# Agent Note: watchdog supervision hardening — launchd supervisor, exit cleanup, stop-timeout, per-pid kills

Status: implemented

English | [中文](2026-08-18-watchdog-supervision-hardening.zh.md)

## Problem

Postmortem of the 2026-08-18 outage (service down from 00:33 until a manual `supervise`) surfaced four design gaps in the watchdog restart story. The `schedule-exit` behavior itself was correct: `last-restart.json` records pid 63193, while the pid that was SIGKILLed (65586) is the later respawn — outside the guard, matching the grep sweep that found no `pkill`/`killall`/`kill -9`/process-group kill anywhere in the guard code. The gaps:

1. **The watchdog had no supervisor.** A bare detached watchdog that dies (SIGKILL, a wide `pkill`, a closed terminal, OOM) leaves the service down with zero automatic recovery — exactly the outage. `supervise --foreground` existed in the CLI and docs, but no launchd plist shipped and none was installed (`~/Library/LaunchAgents` was empty).
2. **No exit cleanup in the watchdog.** The only trap was `USR1`; TERM/INT/normal exit orphaned the instance child and the give-up crash page to PPID 1 (three crash-page orphans on 8/16, ports 26000/21911/26092, all inside the spec's random-port range).
3. **`restart`'s SIGKILL deadline was hardcoded at 10 s** (`waitForExit(pidNumber, 10_000)`) — short for a large session flushing out hundreds of thousands of log tokens — and the escalation's `(forced)` marker went to the CLI stdout while the matching `Killed: 9` landed in the watchdog log, so attribution depended on having captured the caller's command output.
4. **Kills were per-pid everywhere** (`free_port`, `waitForExit`, the `schedule-exit` exit agent) while the test cleanup assumed process groups (spec.ts:728-730). Two models; the watchdog's EADDRINUSE branch exists precisely because single-pid kills leave orphaned listeners holding the port.

## Decision

1. **launchd supervision ships as an artifact.** `scripts/install-launchd.sh` generates `com.dsh.watchdog.plist` into `~/Library/LaunchAgents` — `ProgramArguments` run `supervise --foreground` through `bash -c` (so launchd restarts the CLI, which exits with the watchdog, never the watchdog script directly), `KeepAlive SuccessfulExit: false` (a killed watchdog — non-zero exit — restarts the chain; a deliberate `watchdog-stop` exit 0 stays down), `RunAtLoad`, `DSH_HOME` in `EnvironmentVariables`, stdout/stderr to `state/watchdog.log` / `state/watchdog.stderr.log`. The script bootstraps the job, supports `--force` (TERM the running detached watchdog first so the launchd job becomes the one true owner) and `--uninstall`. The README downgrades the detached `supervise` form to a debug / one-shot tool.
2. **Exit cleanup in both watchdog scripts** (the package `scripts/dsh-watchdog.sh` and the deployment copy in `$DSH_HOME/bin`): `cleanup()` — kill the crash page, `kill_tree` the instance child, remove the pidfile only while it names us — bound to `EXIT` and to `TERM`/`INT` (`exit 143`). SIGKILL cannot be trapped; the next start's `free_port` covers that case.
3. **Configurable stop deadline.** `restart --stop-timeout-ms` (default 30000) replaces the hardcoded 10 s. Right before the SIGKILL, the CLI prints a line naming the pid, which correlates with the watchdog log's `Killed: 9` for the same pid — the two logs align on pid.
4. **Per-pid + descendant sweep, documented, never process-group.** `kill_tree()` in bash (used by `free_port`, the EADDRINUSE retry, and exit cleanup) and `killPidTree()` in cli.ts (used by the `waitForExit` SIGKILL escalation) walk `pgrep -P` descendants deepest-first, so forced kills sweep grandchildren instead of assuming a process group. The README and both script headers state the contract: the supervised instance manages its own children on graceful shutdown; the sweep is the best-effort net for the forced paths. The test cleanup's group kill stays — it targets the setsid'd watchdog itself, which IS a group leader.

## Verification

- `bash -n` clean on the package watchdog, the deployment watchdog, and `install-launchd.sh`; the installer's generated plist lints (`plutil`) and parses with the expected `KeepAlive`/`RunAtLoad`/`ProgramArguments`/env/log keys.
- `pnpm --filter @khorsheed/dsh-ankh-guard typecheck` passes.
- `tests/self-restart-guard.spec.ts`: the new case `restart escalates to SIGKILL after --stop-timeout-ms and reports the forced stop` runs `restart` against a listener that swallows SIGTERM with `--stop-timeout-ms 700`, asserts the grace deadline was honored (≥600 ms), that the output carries `sending SIGKILL` and `(forced)`, and that the new instance comes up; the full suite passes.

## Alternatives considered

**Kill by process group everywhere.** The instance is not setsid'd, so a group kill would require the instance to be a group leader; orphaned listeners (the EADDRINUSE case) are their own sessions with no group to target. A `pgrep -P` descendant walk is the portable superset that works for both.

**Unbounded graceful-exit wait.** A wedged process would stall the restart loop forever; a bounded default (30 s) with an explicit `--stop-timeout-ms` flag is the middle ground.

**External supervisor only (shape B), no watchdog change.** launchd alone guards crashes but self-modification restarts then bypass the credential gate; the layered shape C keeps the gate while making the watchdog itself supervised.

## Consequences

A dead watchdog now heals by itself under launchd; TERM to the watchdog intentionally takes the instance down with it (documented — a manual `kill <watchdog>` is no longer a "leave the instance running" operation); `restart`'s forced stop is attributable across the CLI and watchdog logs; forced paths sweep orphaned listeners instead of leaving them for the EADDRINUSE branch. The current bare deployment (watchdog pid 67131) still needs the one-time `install-launchd.sh --force` adoption to move under launchd — not done in this change, and the deployment copy of the watchdog at `$DSH_HOME/bin` received only the cleanup/kill-tree patch, pending consolidation onto the package script.
