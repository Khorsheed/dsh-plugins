# Agent Note: Development base is the latest local HEAD, not origin/main

Status: implemented

## Problem

AGENTS.md told every agent to "pull before you start" (`git pull --rebase`), wording that treats origin/main as the source of freshness. That premise is inverted in this repository: pushes are coordinated by the human, so local main almost always runs ahead of origin/main (440 ahead / 0 behind on 2026-10-12) and carries every agent's unpushed commits. In that state `git pull --rebase` is a no-op that makes nothing newer — the newest base for new work is local HEAD, not the remote. The wording also hid the real hazard of the rare diverged case: when origin does carry commits this checkout lacks, a mechanical pull-rebase replays the entire shared unpushed stack — including other agents' commits — and lands conflicts (the profiles/web-eval/README* overlap around 3ff8a5d8, resolved in merge 98234ec3) inside work the rebasing agent does not own.

## Decision

The rule is "base new work on the latest HEAD". Before starting: `git fetch origin`, read `git status -sb`. `behind 0` (the norm) — local main HEAD IS the newest base; start from it, no pull needed. `behind > 0` — stop and coordinate with the human/mainline before any rebase: replaying the shared unpushed stack is a coordinator decision, not an agent's mechanical step. Worktrees branched from local main HEAD already sit on the newest base. Recorded in the AGENTS.md multi-agent-concurrency bullet and docs/development.md 「推送与分支保护」.

## Alternatives considered

- **Keep "pull before you start" unchanged.** A harmless no-op in the common case, but it teaches the wrong mental model (remote = latest), and the one case where it does something — divergence — is exactly where an unattended mass rebase is most dangerous.
- **Auto-rebase on `behind > 0`.** Rejected: rebasing other agents' unpushed commits without their context can damage semantics even when hunks apply cleanly, and divergence is rare enough that coordination is cheap.
- **Rebase worktrees onto origin/main instead.** Worktrees branch from local main HEAD, which already contains everything origin has plus unpushed local work; origin adds nothing.

## Consequences

Agents stop reading a no-op pull as a freshness guarantee and start from the true newest base; the diverged case gets an explicit stop-and-coordinate rule instead of an implicit mass rebase. The cost: the rule's correctness rests on the human-coordinated push cadence staying in force — already a documented premise of the push section — and on agents actually running `git fetch` before judging ahead/behind.
