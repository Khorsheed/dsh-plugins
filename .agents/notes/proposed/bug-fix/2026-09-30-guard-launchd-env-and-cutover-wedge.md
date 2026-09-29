# Agent Note: guard gaps from the 0.2.0 cutover — launchd-env boot failure and the mid-cutover wedge

Status: proposed

English | [中文](2026-09-30-guard-launchd-env-and-cutover-wedge.zh.md)

## Problem

The 0.2.0-rc.2 cutover of prod 3080 (2026-09-29/30) surfaced three ankh-guard gaps, all observed live:

1. **launchd-spawned chains cannot boot the instance.** Two launchd-driven chains (kickstart, then bootstrap) produced instance processes that burned CPU and died within ~60 s with a **zero-byte** `boot-attempt.log`, while the identical start command from an interactive shell boots in ~5 s. The spec's bare `node` was one cause (launchd PATH has no homebrew — fixed in the spec by rebinding with an absolute node path), but the zero-output boots persisted *after* the fix, so a second launchd-environment gap remains unidentified (env scrub? cwd? fd plumbing in `launch_instance`?).
2. **A supervisor dying mid-cutover wedges the transaction.** The receipt stays in `restoring`/`awaiting-user`, operator markers (`abort-cutover`/`restore-previous`) are no longer consumed (the recovered loop has no in-memory transaction), and fresh `supervise` invocations refuse to start without an explicit `--cutover-id`. Tonight's recovery required killing the whole chain and resuming with `--cutover-id` — discoverable only by reading `cli.ts`.
3. **Readiness observability and budget.** `WD_BOOT_TIMEOUT` (60 s) is env-only — not exposed on `reconfigure`/`schedule-exit` — and the failure path did not mirror the attempt log into the main log when it was empty, hiding "the instance never wrote a line" for an hour.

## Proposal

- **Environment**: at `configure-launch`/`reconfigure` time, capture the operator shell's essential launch environment (PATH at minimum) into the spec, and have `supervise` inject it when launching the instance — launchd's minimal env stops being a variable. Add a plist self-test to `install-launchd.sh` (boot once under launchd during install, report).
- **Wedge**: teach `supervise` to resume an in-flight cutover receipt without requiring `--cutover-id` when it can prove the selected side's process identity from the receipt; keep the refusal only for `awaiting-user` on a *rejected* target. Document the `--cutover-id` recovery in the README's operations section (it currently lives only in a stderr hint).
- **Observability**: mirror the attempt log into the main log on every failed attempt including the empty case ("attempt produced no output" is itself the signal), and expose `--boot-timeout-ms` on the restart verbs.

## Alternatives considered

**Hand-edit the receipt to `restored`.** Rejected: the receipt is the guard's proof record; fabricating a terminal state erases the failure history the design exists to keep.

**Leave launchd off and run detached supervision.** Tonight's actual stopgap — acceptable for hours, not a posture: a dead detached watchdog leaves the instance without recovery, exactly what the guard exists to prevent.

## Acceptance criteria

- A fresh `launchctl bootstrap` chain boots the instance to ready with no operator shell involved.
- Killing the supervise loop mid-cutover, then starting a bare `supervise`, resumes or safely finalizes the transaction without `--cutover-id` archaeology.
- A failed boot's main-log entry always includes the attempt-log mirror (even when empty).

## Risks

Environment capture must not leak secrets into the spec (PATH-like keys only, never the whole env). Resume-without-id must keep the ownership proofs strict — the point of the wedge refusal was never killing an unproven process by port.
