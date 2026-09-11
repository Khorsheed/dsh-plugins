# Agent Note: a run started as a job can take the container path, and a unit says whether it can reach anything

Status: implemented

English | [中文](2026-09-12-eval-job-container-path.zh.md)

## Problem

Two failures from one run (I4·T29c), both of which made the orchestrator's own plumbing look like a subject's fault.

**A job-started run refused every container condition.** The readiness probe came back with `subagent-codex: the parent session has no working directory to run the CLI in`, and the run refused before a single cell. The chain: the container path deliberately passes no per-round `cwd` (inside a unit a host path means nothing), the provider therefore resolves `intent.cwd ?? parent.session.header.cwd`, and a run started without a calling session — the Remote/CI door, and any `/eval run` whose session has no cwd — opens its own parent session through `ctx.agents.create`, which had no cwd to give. So the container path worked from a browser tab and not from CI, and the sentence explaining why named the harness.

**A unit with no egress produced an empty answer, not an error.** `eval-net` is an `--internal` docker network whose only way out is a sidecar proxy (`HTTPS_PROXY=http://eval-proxy:8888`, baked into the image). With `eval-proxy` stopped — it and `eval-registry` were `Exited (255)` after a daemon restart — codex came up inside the unit, read back its model (`gpt-5.6-sol`) and its sandbox policy, ran for 230 seconds, and returned `task_complete` with `last_agent_message: null`. Every layer above read that as "the probe failed": first as a 120-second timeout, then as `stopReason: "error"`. Nothing anywhere said "network". Four wasted minutes per probe, and the same four minutes would have burned on every cell of the run.

## Decision

- **The session a run opens for itself carries the run's own cell root.** `<stateRoot>/cells/<runId>`, created before the session claims it (a CLI spawned into a missing directory fails in the shell, before the harness that would have explained it). It is the directory the run is about to fill, it lives exactly as long as the run, and it puts a CI-started run in the same place an interactive one works from. A caller-supplied `cwd` still wins and is taken as given — `/eval run` passes the calling session's workspace, which is an existing directory and not ours to create.
- **The plan declares the egress check; the orchestrator owns only the rule.** `unit.egressCheck = { command, timeoutMs? }` runs inside the unit through `lab.verify`: exit 0 passes, anything else — a non-zero exit, a timeout, a `verify` that could not run at all — refuses the whole run as `EGRESS_UNAVAILABLE`. The command and its target belong to the dataset's apparatus, beside the network they describe; an address compiled into eval would be the one thing a plan could not change.
- **Asked before the delegation, and again per cell.** The readiness probe's unit is asked between `acquire` and the round, so a dead proxy costs no delegation at all; each cell's unit is asked between `acquire` and `populate`, which is the only gap there is (mounts cannot be added to a container that already exists) and which catches a sidecar that dies mid-run — exactly how T29c's units became unreachable.
- **`EGRESS_UNAVAILABLE` is its own diagnostic code, not `READINESS_FAILED`.** "The proxy is down" and "this harness cannot authenticate" want different people. The readiness record carries `infrastructure` for the same reason: the subject was never asked, so nothing about this belongs to it.
- **An absent declaration is the old behavior, byte for byte — and the run says so once.** A plan with a `network` and no check logs one line naming what it cannot distinguish. A declaration that is present but would check nothing (`command: []`, an empty word, a non-positive timeout) is refused as `EGRESS_CHECK_MALFORMED`: the contract subset has no cardinality keywords, so the run loop is the only place that can catch it, and a run that believes it was checked is worse than one that knows it was not.
- **The readiness default is 420 seconds.** Measured, not padded: the 120-second host-path value cancelled container probes while they were still legitimately starting (a cold 3.2GB image plus the CLI's first `docker exec`), and a cancelled probe reads exactly like an unauthenticated harness. `readinessTimeoutMs` still narrows it.

## Testing

- Both start paths produce **identical readiness text** on the same container plan — the job path with no calling session at all, which is the shape that used to refuse — and the job's session is pinned to the run's cell root.
- The egress refusal is pinned end to end: `EGRESS_UNAVAILABLE`, the command and its stderr in the message, and `agent.calls` empty — no delegation was spent.
- Verb order on the cell path is pinned as `acquire, verify, acquire, verify, populate`: the probe's unit and the cell's, each asked before it is used.
- A networked plan with no declaration logs exactly one note and calls `verify` zero times (the old shape, unchanged).
- `checkUnitEgress`'s four failure branches (exit code, stdout fallback, timeout, a `verify` that throws) and `egressCheckOf`'s parsing are unit-pinned.
- Real machine (3171, on host 0.1.5-rc.1): `/eval run` started as a job drove a P0 × codex container cell to `released`; with `eval-proxy` stopped, the same plan refused at the check, naming the proxy.

## Alternatives considered

**Give the container round an explicit host `cwd` so the parent's does not matter.** Rejected: the container path passes none deliberately — a host path inside a unit is meaningless, and recording one on the delegation would make the record say something untrue about where the round ran. The parent session needing a workspace is a real requirement of the provider; the fix is to give it one.

**Build the egress check into eval with a default target.** Rejected: an evaluation network's proxy, registry and whitelist are the dataset's apparatus. A default address in the orchestrator would be right for exactly one lab and wrong everywhere else, and it would be the one part of the environment a plan could not change while still being hashed into nothing.

**Derive the check from the image's own `HTTPS_PROXY`.** Tempting — it needs no declaration — but it assumes a tool inside the unit to probe with, and silently becomes a no-op in an image without one. An explicit declaration cannot silently become a no-op.

**Treat a failed check as one condition's readiness failure.** Rejected: the unit is per-cell but the network is not. One unreachable unit means the next one is unreachable too, so refusing the run is the honest scope — and `--ignore-readiness` must not be able to wave it through as "that condition is skipped".

## Consequences

- A CI-started run can take the container path. The Remote door and `/eval run` now differ in nothing the run can observe.
- Plans on an internal network should declare `unit.egressCheck`; the ones that do not keep running exactly as before, with one line in the log saying what that run cannot tell apart.
- `dataseek.plan/1` gains an optional `unit.egressCheck`; the dataset-authoring protocol's §6 publication and both READMEs carry it. The plan hash changes only for plans that declare it.
- The readiness default is three and a half times longer. A genuinely unauthenticated harness now takes up to 420 seconds to say so on the container path — the cost of not cancelling honest cold starts. The declared egress check is what keeps the common failure fast.
