# Agent Note: false "unplanned exit" reports on watchdog takeover — eval-line 3171 incident

Status: proposed

English | [中文](2026-09-27-watchdog-takeover-false-unplanned-exit.zh.md)

## Problem

Reported by the eval-line coordinator and verified in `~/.dsh-lab/state/`: the 3171 eval instance keeps generating **unplanned-exit reports for exits that were expected**. Evidence chain:

- `watchdog.log` shows the repeating pattern: a new watchdog takes over (`waiting for the current owner of :3171 to exit` → `port free — taking over` → fresh start → ready), and immediately logs `unplanned exit recovered — left a report record for the next session` (lines 243–267, recurring 2026-09-24/26/27).
- `last-restart.json` records `{"unexpected":true}` for the previous instance's exit even when that exit was the eval line's own planned bounce (`eval-instance.log` shows the corresponding `[t29c] instance exited with 0` — clean, orchestrator-driven).
- The ownerless record is then claimed by **the first root agent created** (restart-context.ts design: lazy restore means only the initiator can be woken; ownerless goes to the next new session). On the eval line those are auto-created cell sessions across `~/code/*` workspaces — so the false "非计划退出" report surfaces in a session that had nothing to do with the exit, which is how the coordinator met it.

Root cause: the eval line's lifecycle exits the instance **outside the guard's plan markers** (its launcher/upgrade flow stop-marks the *watchdog*, but the *instance's* exit carries no plan marker), and the successor watchdog has no concept of a succession window — any exit it didn't schedule is "unexpected".

## Proposal

Two layers, complementary:

1. **ankh-guard (owner: this repo)**: teach the watchdog the succession window. When a watchdog exits via stop marker, it writes a handoff record covering the instance's next exit; a successor watchdog that just took over the port treats an exit inside that window as a planned handoff (role=`handoff`), not `unexpected`. The guard already persists both supervisor and child identities, so the window can be bound tightly (same command, same home, exit after old-supervisor stop and before new child ready).
2. **eval line (owner: coordinator)**: where its upgrade flow bounces the instance deliberately, mark the exit through the guard (the sanctioned stop verb) rather than letting the watchdog discover a bare exit — defense in depth that also covers non-succession bounces.

(1) is the honest fix — the watchdog has all the evidence; (2) covers paths (1) can't see.

## Alternatives considered

**Tell the eval line to stop supervising 3171 with ankh-guard.** Rejected: the supervision caught real failures before (the T33a readiness rollback), and un-supervising loses canary/proof for the line's deploys.

**Classify every exit-0 as planned.** Rejected: a crashed host can exit 0 under some killers; the marker, not the code, is the plan signal.

## Acceptance criteria

- An eval-line redeploy or cell bounce produces no unplanned-exit report and no `unexpected:true` record.
- A genuinely unplanned exit (kill -9, fatal error) still produces the report record and the next-session claim.
- watchdog.log shows the handoff classified as such (role/distinguishing line), with tests in ankh-guard's suite covering: stop-marker → successor takeover → instance exit = planned; bare exit without markers = still unexpected.

## Risks

A too-wide succession window could mask a real crash during takeover; the window must be bound to observed supervisor/child identities, not wall-clock generosity. The eval-line half (2) needs the coordinator's sequencing against their in-flight work.

## Related

- The claim mechanism that surfaces ownerless records: `packages/ankh-guard/src/restart-context.ts`.
- The eval launcher whose bounces trigger this: `~/.dsh-lab/bin/eval-launch.mjs` (scratch, untracked — its header documents the watchdog readiness contract it already honors).
