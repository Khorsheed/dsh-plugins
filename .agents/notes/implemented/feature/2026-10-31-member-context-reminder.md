# Agent Note: CLI members' context rings and the compaction reminder

Status: implemented

## Problem

The user's 2026-10-31 decisions (mockup `proposals/prototypes/member-compaction.html` v2) ask for:

- **Occupancy:** a CLI member's context occupancy shown like the host's (a ring and a percentage at the end of the stats line).
- **Button:** a compact button that only context-guard draws, and only past a ratio.
- **Ratios:** set per CLI and per member, with precedence member > CLI > global.
- **Room:** the coordinator's ring and button in the composer; every member's ring in the members popup, with an attention dot on the chip.
- **Independence:** context-guard and the local-agent family must not depend on each other.

The host's ring and button cannot reach a member session. The member composer hides the host input bar, and host `/compact` acts on a dsh agent.

## Decision

- **Occupancy data (local-agent family).** After each round a driver writes one `local-agent/context {provider, usedTokens, contextWindow}`, registered with the host. It writes only when the reading moved.
  - Kimi: the ACP `usage_update {used, size}` it sends after a turn.
  - Codex: `thread/tokenUsage/updated` (`last.inputTokens`, `modelContextWindow`).
- **Auto compactions.** A compaction the CLI runs on its own records `local-agent/compaction` with source `auto`.
  - Kimi: from the wire, read from the line count at prompt time, or from line 0 when the wire did not exist yet.
  - Codex: from a `contextCompaction` item inside a normal turn.
- **Reading it back.** The `memberContext` Remote reads the latest occupancy. A later completed compaction overrides it with its after-count. Codex states none, so the occupancy is unknown until the next round.
  - It also returns the run state (`idle` / `running` / `compacting`) and the harness (`kimi`, `codex`).
  - Cold sessions are read once from the stored log.
- **Member-tool registry (local-agent client).** `localAgentUi.registerMemberTool({id, render(face)})` and `renderMemberTools(child, placement)`.
  - `meter` is local-agent's own ring, styled like the host's ContextMeter. Clicking it opens a portalled panel with the figures and the `panel` tools.
  - The other placements render only registered tools: `composer`, `row`, `panel`, `dot`.
  - One shared 1.5 s poll per member feeds every surface.
  - The face is plain data plus `compact()`, which sends `/compact` through the member inbox.
- **Member composer.** The ring ends the stats line, the `composer` tools sit before the model seat, and a `/` menu offers 压缩 compact.
- **context-guard.**
  - It probes `localAgentUi` and registers a `MemberGuard` that draws:
    - 「⚠ 压缩」 past the effective ratio (「压缩中…」 while compacting);
    - the dot;
    - 「此成员的提醒比例」 in the panel, which writes `memberThresholds`.
  - The section gains two volatile fields: `harnessThresholds` (by harness name) and `memberThresholds` (by session id, with name and harness).
  - The settings card gains an 外部 CLI group from `localAgentUi.harnessCards()`, plus the per-member list with 清除.
- **Room.**
  - An external coordinator's `meter` ends the stats line, and its `composer` tools sit in the composer row.
  - The members popup gains a 上下文 column (`meter` + `row`); the chip shows the first `dot`.
  - The composer gains the `/` menu, including after an @mention.
  - A human `/compact` no longer advances the member's prompt cursor, so a pending handoff or room change still rides the next real prompt.

## Alternatives considered

- **A child slot `local-agent.member.tools`, as the mockup said.** A child slot is declared by one entry and rendered inside its tree. The room composer is another tree, so it could not render the slot. A service registry (the same pattern as `harnessCards`) reaches both trees and keeps the edge optional.
- **Writing `request/context` into member logs so the host `contextPressure` projection works.** That projection cannot see our compactions, and the host ring is hidden in member sessions anyway.
- **Each surface polling on its own.** A room with several members would multiply the requests. One store per member serves all surfaces.

## Consequences

- With only the local-agent family installed, members show the ring and no button. With only context-guard installed, nothing changes. With both, the reminder appears per member's ratio.
- The settings card's ratios apply live through the settings scope.
- Codex leaves the occupancy unknown after a compaction until the next round reports it.
