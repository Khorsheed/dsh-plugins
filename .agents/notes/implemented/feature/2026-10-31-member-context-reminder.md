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
  - Claude Code: the last top-level `assistant` message's prompt (`input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`). The window comes from the `result` event's `modelUsage[model].contextWindow`. A subagent's messages (`parent_tool_use_id`) never count. Only the live driver records it; the exec fallback does not.
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
  - The face is plain data plus `compact()`. By default it sends `/compact` through the member inbox. A surface with its own compaction pipeline passes `options.compact` to `renderMemberTools`, and that replaces the default.
- **Member composer.** The ring ends the stats line, the `composer` tools sit before the model seat, and a `/` menu offers 压缩 compact.
- **context-guard.**
  - It probes `localAgentUi` and registers a `MemberGuard` that draws:
    - 「⚠ 压缩」 past the effective ratio (「压缩中…」 while compacting). After an accepted request it stays disabled until the member's state moves. A room may queue the compaction behind a running round, so a second click would queue a second compaction. An idle member re-arms it after 30 s.
    - the dot;
    - 「此成员的提醒比例」 in the panel, which writes `memberThresholds`.
  - The section gains two volatile fields: `harnessThresholds` (by harness name) and `memberThresholds` (by session id, with name and harness).
  - The settings card gains an 外部 CLI group from `localAgentUi.harnessCards()`, plus the per-member list with 清除.
- **Room.**
  - An external coordinator's `meter` ends the stats line, and its `composer` tools sit in the composer row.
  - Every named member's `compact` is the room's own `/compact` dispatch (`submit(room, '/compact', [name])`). That includes the coordinator ring on the stats line, which gets its name from the roster. The reminder button runs exactly what the typed command runs: the 「正在压缩」 run card, the `room/member-compacted` row, and the Context Lens compaction request. The member inbox would compact the CLI without the room's journal seeing it.
  - The members popup gains a 上下文 column (`meter` + `row`); the chip shows the first `dot`.
  - The ring joins the stats line at that line's metrics (12px / 20px, a 12px ring) through `--dsh-member-context-*` variables; the composer keeps the host meter's 13px.
  - The chip's arrow is the room's chevron icon.
  - The breakdown is clamped to the composer column, not the viewport, because a split pane is narrower than the window. Below 560px of column (a container query), it drops 输入, 缓存命中, 输出 and 耗时.
  - The composer gains the `/` menu, including after an @mention.
  - A human `/compact` no longer advances the member's prompt cursor, so a pending handoff or room change still rides the next real prompt.

## Alternatives considered

- **A child slot `local-agent.member.tools`, as the mockup said.** A child slot is declared by one entry and rendered inside its tree. The room composer is another tree, so it could not render the slot. A service registry (the same pattern as `harnessCards`) reaches both trees and keeps the edge optional.
- **Writing `request/context` into member logs so the host `contextPressure` projection works.** That projection cannot see our compactions, and the host ring is hidden in member sessions anyway.
- **Room button through the member inbox, with Context Lens reading the member log.** The room would still show no card and no compaction row, and a typed `/compact` and a button press would leave different records. One path is simpler.
- **Each surface polling on its own.** A room with several members would multiply the requests. One store per member serves all surfaces.

## Consequences

- With only the local-agent family installed, members show the ring and no button. With only context-guard installed, nothing changes. With both, the reminder appears per member's ratio.
- The settings card's ratios apply live through the settings scope.
- Codex leaves the occupancy unknown after a compaction until the next round reports it.
