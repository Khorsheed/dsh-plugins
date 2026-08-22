# Agent Note: plugin ops model — three environments, tarball into prod, flow not approval

Status: implemented

English | [中文](2026-08-20-plugin-ops-model.zh.md)

## Problem

With 16+ packages approaching first publication and several agents shipping to the shared prod instance (3080) at once, the repo had no agreed lifecycle for how a plugin travels from development to community. The improvised state had already produced its failure modes: prod served whatever `lib/` happened to contain (15 `link:` deps — one restart away from shipping anyone's WIP), the profile was hand-edited by multiple agents (a sub-profile-only bundle got mounted into the main profile and made it unbootable), and "when is a plugin ready for npm" had no answer beyond vibes.

## Decision

The lifecycle and its rules live in [docs/ops.md](../../../docs/ops.md). The load-bearing choices:

- **Three environments with tightening delivery**: `link:` only for throwaway dev instances; **prod 3080 accepts tarballs only** (entering prod is an explicit version decision, never the state of someone's `lib/`); npm follows after prod runs clean.
- **A six-step acceptance gate** for every profile change: green build/test/hygiene → pack-dist tarball (previous known-good kept in `dist-legacy/` for minute-level rollback) → profile refresh → credential + preflight (never bypassed) → gated restart with canary watch → public announcement.
- **Flow, not approval**: any developer may drive a change into prod, but only by running the whole flow — the profile is written by the flow, never by hand. The instance guardian (the kimi-code agent) watches topology/credentials/drift and cleans up anomalies; it is not the sole driver. The flow is executable: `pnpm deploy:3080 --package <dir>` (scripts/deploy-3080.mts) runs the six-step gate end to end, prints the announcement, and refuses first-time profile additions.
- **Independent release cadence** (no lockstep), with the local-agent family co-released in dependency order, and the planned 整合包 as a **thin meta-package**: dependencies only, no bundle patch of its own, so children self-mount and stay individually add/removable inside the bundle.

## Alternatives considered

- **Keep prod on `link:` for iteration speed** — rejected: a restart then ships whatever `lib/` contains, including unfinished work; the incident cost exceeds the repack cost.
- **Guardian as single writer/approver for the profile** — rejected: a bottleneck that scales poorly and invites shadow edits; the mechanical gate, not a person, is the guardrail.
- **Lockstep releases** — rejected: package maturity varies; only the local-agent family needs coordinated release (registry dependency order).
- **Fat meta-pack with its own patch inserting every child row** — rejected: removing one child would fight the pack-owned rows; thin deps-only keeps children independently removable.

## Consequences

- [docs/ops.md](../../../docs/ops.md) is the single reference; [docs/publishing.md](../../../docs/publishing.md) keeps the npm mechanics. AGENTS.md points at both.
- The prod profile still carries `link:` deps from before this decision; converting it to all-tarball is the first application of the rule and is scheduled once the ankh-guard supervisor rework settles.
- message-timeline's publish-vs-private call, the local-agent family version alignment (claude-code still rc.5), and the meta-pack's name/versioning are open items for the acceptance rounds.
