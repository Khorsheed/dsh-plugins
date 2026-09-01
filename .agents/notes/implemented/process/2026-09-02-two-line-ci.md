# Agent Note: CI reports on the line we are adapting to, and gates on the line we ship

Status: implemented

## Problem

`ci.yml` pinned one harness ref (`dsh-v0.1.1-rc.2`) and every gate ran against it. That is correct for what we ship — the stable line is what `npm install @deepseek-ai/dsh` still gives a community user — but it left the adaptation work unverified by anything. Once alpha-adapted code lands on main, CI keeps checking it against a host it was not written for and reports green, while nothing at all checks it against the host it was written for.

The gap has a deadline. The upstream alpha line moved from `alpha.1` to `alpha.4` inside a week while `latest` stayed at `0.1.1-rc.2`, and ankh-guard's adaptation is about to merge — a plugin whose failure mode on the stable line is not "feature missing" but "the restart gate is broken", because 3080 runs the stable line and ankh-guard is what gates its restarts.

## Decision

Two jobs, with different authority:

- **`gates`** — the stable line, pinned, **blocking**, all fourteen steps.
- **`alpha-compat`** — the line being adapted to, **non-blocking**, install + build + test only.

`alpha-compat` resolves its ref from npm's `alpha` dist-tag (`dsh-v<version>`, the harness's release tag convention) rather than pinning a version in the workflow.

Only harness-sensitive steps run in the alpha job. Hygiene, plugin independence, the doc gates and the mirror check never read the harness, so repeating them would double the cost for no new signal.

## Alternatives considered

**Make the alpha job blocking.** Rejected, and this is the decision most likely to be revisited. The alpha line ships on upstream's cadence — four releases in a week — so a required check would go red for reasons that are not ours, at times we do not choose. A gate somebody else can turn red at will is one people learn to route around, and a gate that gets ignored protects nothing. The same reasoning retired the slow-lane test project (see [the subprocess timeout note](../testing/2026-09-01-subprocess-test-timeout.md)): a lane excluded from the default path drifts toward never being run, and a lane that cries wolf drifts toward never being read.

**Pin the alpha ref like the stable one.** Rejected: a pinned alpha rots within days, and a job testing a host nobody is adapting to any more keeps passing while meaning nothing. Tracking the dist-tag costs reproducibility — the same commit can produce different alpha results on different days — which is acceptable precisely because the job is informational. The blocking job stays pinned and reproducible.

**A matrix over the whole `gates` job.** The obvious shape, and it would have run every step twice. Rejected once the steps were sorted: only install/build/test read `DSH_HARNESS`. The rest are harness-independent, and doubling them buys nothing but minutes.

**Wait for the alpha line to stabilize into an rc.** Rejected because the adaptation is happening now — ankh-guard merges today — and code merged unverified against its target line accumulates until the baseline migration, which is exactly when nobody wants to discover it.

## Consequences

- A package that works on only one line is visible before the baseline migration rather than during it.
- The alpha job can be red for days through no fault of ours. That is the price of tracking a moving target, and the reason it cannot gate anything. Read it as a report; if it is red, look at *which* package.
- `pnpm gate` still runs against whatever `DSH_HARNESS` points at locally, so a developer adapting to alpha gets alpha results locally and stable results in CI. The gate's harness-ref advisory names which line produced the local green.
- Publishing is unaffected: `minHost` floors do not move when we adapt to a newer line (docs/ops.md), so adapting to alpha never raises what a community user needs.
