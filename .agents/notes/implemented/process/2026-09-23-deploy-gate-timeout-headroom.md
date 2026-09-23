# Agent Note: deploy-3080 widens the preflight/canary windows — they bound hangs, not slowness

Status: implemented

## Problem

On the shared 8-core/16GB deploy host, `pnpm deploy:3080` intermittently failed
its gate with timeouts while the composition was actually healthy. Investigation
on 2026-09-23 found the machine at load average ~32 with 19.9GB of 21.5GB swap
used (a 9-day-orphaned headless Chrome alone burned ~1.5 cores), yet a manual
full-profile composition preflight PASSed in 26.5s and every watchdog restart in
the preceding two days went ready in 17-35s with canary PASS. The gate's two
deadlines — the guard's 120s `DEFAULT_PREFLIGHT_TIMEOUT_MS` (deploy-3080 did not
override it) and the deploy script's own 180s canary window — were calibrated on
an idle machine, so multi-agent build/test pile-ups turned a slow-but-clean run
into a refusal. Both refusals are safe by design (they fire before the instance
stops), but they cost a full deploy retry each.

## Decision

`scripts/deploy-3080.mts` now passes `--preflight-timeout-ms 300000` to
`schedule-exit`, and its post-restart canary window is 300s (was 180s). The
guard's defaults are unchanged — callers facing the shared production host opt
into the wider windows explicitly. The semantic is recorded at both sites: these
timeouts exist to catch a HUNG preflight or restart, not a slow one.

The refusal semantics are untouched: an exhausted window still refuses before
the instance stops, so the failure mode stays "retry the deploy", never "the
service went down unproven".

## Alternatives considered

**Load-aware queueing (the deploy waits until machine load drops before starting).**
Rejected for now: with 300s windows the measured 26.5s preflight has ~11x
headroom, and the refusal-before-stop design makes a residual timeout a cheap
retry. A queue would hold the deploy lock while parked (serializing other
deploys behind an idle wait), hang the invoking agent's shell for an unbounded
time, and add state for a case the wider windows already absorb. Revisit if
timeouts reappear at 300s.

**Raising the guard's own `DEFAULT_PREFLIGHT_TIMEOUT_MS`.** Rejected: the 120s
default is the right bound for interactive/standalone use of `dsh-ankh-guard`;
the shared-host contention is a property of this deployment, so the deploy
orchestrator carries the override.

**Shrinking the preflight work itself (e.g. built-surface dry-runs).** Rejected
as out of scope: the source surface is deliberate (it dry-runs what a source
boot would hit), and 26.5s is fine — the problem was the margin, not the speed.

## Consequences

- Deploys survive load spikes that previously produced false gate failures; the
  real fix for the host remains hygiene (the orphaned browser was killed,
  freeing ~2.7GB of swap immediately).
- `scripts/deploy-3080.spec.ts` pins the `--preflight-timeout-ms 300000` pair on
  the schedule-exit invocation.
- A genuinely hung preflight now costs up to 5 minutes before refusal instead of
  2 — accepted: hang is the rare case, slowness is the common one.
