# Agent Note: deploying ankh-guard itself needs `reconfigure`, not `schedule-exit`

Status: implemented

## Problem

`pnpm deploy:3080 --package packages/ankh-guard …` self-blocks at step 5. The live watchdog's persisted launch spec pins the preflight runner by **path + sha256**, and that path is the repo build output (`packages/ankh-guard/lib/preflight-runner.js`). The deploy's step 1 rebuilds ankh-guard, so any deploy whose diff touches `preflight-runner.ts` rewrites the bound file; at `schedule-exit` the *old* watchdog compares the current file against the recorded hash, finds a mismatch, and refuses with `the bound preflight runner changed after launch configuration` — an infra failure, not a composition verdict, so the instance keeps running and nothing restarts. Deploys of ankh-guard that do NOT touch the runner never hit this (the rebuild is byte-identical), which is why the gap surfaced only on 2026-09-26, with the first runner change since the binding machinery landed.

A second, independent tripwire sits right behind it: the cutover canary re-verifies the green-build credential (`verify` = fresh + HEAD match on the harness checkout) with a **10-minute** freshness window. A schedule-exit refusal plus a few minutes of diagnosis, then reconfigure's own composition preflight (~2–3 min) and boot, easily pushes the credential past 10 min — the first reconfigure attempt on 2026-09-26 failed its canary at 13 minutes and rolled back cleanly (`restore-previous` worked as designed).

## Decision

**Shipped (same day, follow-up commit): deploy-3080 now handles the drift itself.** Step 5 picks its restart verb by reading the live `state/launch-spec.json`: when the pinned runner file's sha256 no longer matches the recorded hash, the flow prints the rebind notice, re-records the green credential (reconfigure runs its composition preflight twice, and the 10-minute freshness window must still be open at canary time), and restarts through `reconfigure --on-failure restore-previous` with every field copied from the live spec (`command`, `home`, `credentialRepo`, `harnessRoot`, `profile`, `preflight.*` including `candidateProbeCommand`). No spec, an unreadable spec, or an unchanged runner keeps the ordinary `schedule-exit` path; a drifted runner with a spec field missing refuses loudly and points at the manual runbook below. `--initiator` routing is schedule-exit-only — on the reconfigure path the receipt lives in `launch-cutover.json`.

The manual runbook (still the fallback the automation refuses over):

1. Let the deploy finish steps 1–4 (build+test, pack, profile refresh, credential) — the refusal leaves them intact and stops nothing.
2. Run the diagnostic preflight once with the new runner as a zero-risk proof on the real profile: `DSH_HOME=$HOME/.dsh-official node packages/ankh-guard/lib/cli.js preflight --profile web --preflight-surface built --preflight-install-anchor <harness>/apps/cli/package.json`.
3. **Re-record the credential immediately before the restart** (the 10-minute window must cover preflight + boot + canary): `record build --trust-command --command 'pnpm deploy:3080 (build+test green)' --repo <harness>`.
4. Restart via `reconfigure` — the sanctioned transactional path that rebinds the launch spec (runner hash recomputed from the current file) and cuts over with `--on-failure restore-previous`. Take every field from the live `launch-spec.json` (`active.command`, `home`, `credentialRepo`, `harnessRoot`, `profile`, `preflight.*` including `candidateProbeCommand`); do not invent a new start command.
5. Verify: watchdog log shows `canary PASS`, `launch-cutover.json` reaches `phase: ready`, and the spec's `runnerSha256` matches the on-disk file again.

Never work around the refusal by restoring the old runner bytes: the respawned watchdog inherits the persisted spec, and the next restart gate would trip on the same mismatch — only `reconfigure` rebinds durably.

## Alternatives considered

**Restore the old runner bytes for the schedule-exit, then rebuild.** Rejected: the respawned watchdog inherits the persisted spec with the old hash while the repo file is the new build, so every later restart gate trips on the same mismatch — and the restarted guard's own `verify-restart` may read the drift as tampering. Only `reconfigure` rebinds durably.

**Teach deploy-3080 to detect the drift and route through reconfigure itself.** Shipped in the follow-up commit — see Decision. The cutover flags come from the live `launch-spec.json` field-by-field, never invented; a spec missing any required field is the one case that still refuses to a human.

**Manual kill of the host child and let the watchdog respawn.** Rejected: an ungated restart bypasses the preflight contract AGENTS.md mandates for 3080, and repeated boot failure would risk the watchdog rolling the harness checkout back.

## Consequences

2026-09-26 deploy: ankh-guard 0.3.1 (preflight mounts its computed runtime resolution) + taskpilot 0.3.1 shipped to 3080 through the manual version of this path — composition preflight PASS with the fixed runner, cutover `ready`, canary PASS, runner rebind verified. The automation landed the same day (`scripts/deploy-3080.mts`'s `restartVerb`, pinned by three new cases in `scripts/deploy-3080.spec.ts`: unchanged runner keeps schedule-exit, drift rebinds through reconfigure with a credential re-record, a spec field missing refuses loud).

## Related

- [preflight mounts its computed runtime resolution](2026-09-26-preflight-mounts-runtime-resolution.md) — the fix whose deploy surfaced this gap.
