# Agent Note: Refresh the skill grid until the host watcher publishes a mutation

Status: implemented

## Problem

Installing a skill from the 工具与技能 panel reported success while the new card never appeared; the grid kept its pre-install rows until the panel was reopened. The catalog lists `ctx.skills.snapshot()` for the preset's standing scope, and that registry learns about a new bundle from the skill-filesystem watcher. The catalog writes skills with `node:fs`, and the host's only synchronous invalidation path is the `fs/observed` event, which the model-facing filesystem tools raise — a plugin write raises nothing. The registry therefore catches up on chokidar's schedule (200 ms stability threshold) a moment after the operation returns, while `AddSkillModal` refreshed exactly once, immediately, and the panel never queried again: that single refresh read the pre-change snapshot by construction. Deleting a skill had the same shape.

## Decision

`refreshUntilSettled(read, refresh, settled)` replaces the bare refresh on the two skill mutation paths. It refreshes immediately — preserving the old behaviour for mutations the registry already knows about, and giving the overwrite path a fresh read instead of an early return — then re-queries on a bounded backoff (250/500/1000/1500 ms), stopping as soon as the predicate accepts the snapshot. Add waits for every name the result reported (`installedNames` splits the host's `', '`-joined list, so a multi-skill `--skill '*'` install is covered); delete waits for the name to disappear. The store exposes it as `refreshSettled` on the injected face. The MCP paths keep their single refresh: their state is read from the host's MCP store, not from a watched directory.

## Alternatives considered

**Delay the refresh by a fixed interval.** Rejected: the guess is either too short (still stale) or too long (the success message sits there while the card is missing). Settling on the observed state is faster in the common case and correct when the watcher is slow.

**Have the catalog invalidate the host registry synchronously.** Rejected for now: `observeHostMutation()` exists only on the concrete `FileSystemSkillProvider`, not on the shared `SkillProvider` interface, so a plugin could reach it only by duck-typing a private class. That belongs in an upstream interface change; this repo tracks the host and does not modify it.

**Poll until the skill appears, unbounded.** Rejected: a genuinely refused write would spin the UI. The schedule is bounded and the last result stands.

**Refresh the whole panel on a timer.** Rejected: a background poll spends a Remote round-trip per interval per open panel to hide a sub-second race.

## Consequences

An install or delete now updates the grid by itself, typically on the second query (~250 ms). The worst case is ~3.25 s, after which the stale read stands — exactly the old behaviour. The client issues up to five snapshot queries per mutation instead of one. Covered by `tests/settle.spec.ts`: the immediate attempt, the retry-until-visible sequence, the bounded give-up, a snapshot that never landed, and the multi-name parse.
