# Agent Note: watchdog launch without process substitution; crash page serves 503

Status: implemented

English | [中文](2026-08-20-watchdog-sandbox-safe-launch.zh.md)

## Problem

Two defects surfaced from the first fresh-machine self-restart test (npm-installed host, agent-driven restart under a sandboxed tool runner), both in `scripts/dsh-watchdog.sh`:

1. **The instance never launched.** The watchdog started the instance with `launch_instance > >(tee -a "$ATTEMPT_LOG") 2>&1 &`. Bash process substitution opens a `/dev/fd/N` descriptor for the child; sandboxed or otherwise restricted spawners (the agent tool runner's workspace-write sandbox) deny that open with EPERM, so every boot attempt died at the shell layer before the instance binary ran — four failures, crash page, and the retry button re-hit the same line. The rollback logic behaved correctly throughout (target was HEAD, reset skipped) but could never help: the failure was environmental, not in the checkout.
2. **The give-up crash page returned HTTP 200.** Any probe that treats a 200 on the port as "service healthy" — including simple deployment checks — read the crash page as the live instance, masking the outage.

## Decision

- The instance launch uses plain redirection only: `launch_instance > "$ATTEMPT_LOG" 2>&1 &`. No process substitution anywhere in the watchdog. On a failed attempt the captured output is mirrored into the watchdog log (prefixed `[instance] `), so failure diagnosis still lives in one place; a healthy boot's message names the attempt-log file the instance's output is written to.
- The crash page serves **503** for the HTML page; the `/restart` action endpoint stays 200. A 200 now always means the real instance answered.

## Alternatives considered

- **`launch_instance 2>&1 | tee -a "$ATTEMPT_LOG" &`** — loses the child contract: `$!` names `tee`, not the instance, and the two are siblings, so `kill_tree`/`wait`/liveness checks against `$!` would reap the wrong process and orphan the instance.
- **A `tail -f` bridge from the attempt log into the watchdog log** — preserves live interleaving but adds a third process to supervise, reap on every exit path, and race against truncation; rejected as complexity bought for a debug nicety.
- **Keep 200 and fix every probe instead** — every consumer of the port would need special-casing forever; the truthful status code fixes all of them at once.

## Consequences

- Instance stdout no longer interleaves live into `watchdog.log`; it lands in `state/boot-attempt.log` (truncated per attempt), with failures mirrored back. What is given up: live-follow of a healthy instance from the watchdog log.
- The watchdog's own `healthy()` (200-only) can no longer be fooled by its own crash page, and external monitors see the outage.
- Sandboxed self-restart flows (the agent spawns the watchdog from inside a workspace-write sandbox) now work; this was the blocker for the fresh-machine "dsh installs and restarts itself" scenario.
