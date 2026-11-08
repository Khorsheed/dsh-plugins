# Agent Note: Member subagent cards in the member session

Status: implemented

## Problem

A member CLI's own subagents (Kimi `Agent` / `AgentSwarm`, Claude Code `Agent` / `Task`) are mirrored as grandchild sessions under the member's child session ([CLI subagent sessions in the core](2026-11-06-cli-subagent-sessions-core.md), [Claude subagents mirrored](2026-11-06-claude-subagents-mirrored.md)). In the member session the call that started one was still the host's generic tool row: no status, no elapsed time, no way to see what the subagent did or to open it. In the room, a member waiting for a foreground subagent read only 「正在工作…」. The member-cli-subagents design (step M5; UI in `proposals/prototypes/member-activity.html`, the 「成员会话」 group and 「运行卡片 · 正在等子智能体」) asks for a live card that behaves like the host's own subagent run card, sharing one card shell with the background-command card ([member activity UI](2026-11-06-member-activity-ui.md)).

## Decision

**One read in the core, no stored copy.** `local-agent` adds `memberSubagentCalls(childSessionId)` (registry method and gateway Remote) backed by the pure fold `packages/local-agent/src/subagent-calls.ts`: the member's `subagent/catalog` rows whose child id is `<member>.sub.<key>` name the grandchildren; every grandchild `local-agent/execution` start with a `cli-subagent` cause is one entry `LocalAgentSubagentCall` — call id, grandchild session, type and description (the descriptor label split at `<type>: `), group place, background flag, ordinal (the nth call of that subagent: a Kimi resume is ordinal 2+), the first turn, state (`running` while the end record is missing; `done` / `failed` / `cancelled`; `uncertain` reads `lost`), start and end times, the sum of the execution's per-request usage, and its ordered steps (request with its first line of thought and generation span, each tool with the argument a reader recognizes and its execution span, and the final text as the reply once the call ended `done`), the latest 40 kept. Null for a session that is not a family member.

**Cards in room, on the shared shell.** `packages/room/src/client/subagent-card-view.ts` folds a call row plus the read into one card state; `SubagentCards.tsx` renders it through `ActivityCardShell`, which gains optional props (spinner instead of the icon, tag, usage, status override, rows). The toolview is registered for `Agent`, `AgentSwarm` and `Task` on ui-tool's keyed `tool.call.toolview` through `slots.inject`:

- **single** — collapsed by default: spinner, type (探索 / 编写 / 通用, the CLI's word otherwise), description, 「运行中 · 1:12」 clock, 「已用 32.2K」, 「展开 ▾」, 「打开」; a second line with the latest step while running. Expanded: the ordered steps, the latest highlighted. Done: 「完成 · 2 分 43 秒」 and 「输入 · 缓存 · 输出」 (the cache bucket only when it is non-zero).
- **group** (an `AgentSwarm` call, or several executions on one call id) — expanded by default: 「◇◇ 并行 3 个」, a summary pill 「运行中 · 2 完成 · 1 在跑」, 「合计」, one row per subagent with its own pill and 「打开」; past six rows, five and 「另外 N 个」.
- **tags** — 「后台」 for a background call, 「续用 · 第 n 次」 for a resumed one; **cancelled** and **lost** carry the prototype's one-line explanation.
- **pending** — the call runs and no grandchild is written yet: a running card without 「打开」.
- **unsupported** — a settled call with no grandchild (older logs are not backfilled; a provider that does not mirror): 「暂不支持查看过程」, no 「打开」, no usage.
- **fallback** — local-agent answers null (not a member session) or nothing is read: a plain row in the generic row's shape (the keyed slot has no decline path, so the host's own row cannot be rendered from inside an entry).

「打开」 opens the grandchild in the right sidebar's subagent chat (ui-subagent's `openChildAside` address, `dsh-resource://subagentchat/session/…`), the whole page on a narrow window or when the sidebar resource is absent.

**The room run row.** While the member's round runs and the read has a running, non-background call that started in this round, the row's current action reads 「· 正在等子智能体：探索 · 6 分钟」 with 「看子智能体」 (opens the member session; the card scrolls itself into view through the shared `ActivityReveals`). A narrow row shows 「· 等探索 · 6 分钟」 and drops the link — the whole row already opens the member session. `RoomRunView.tsx` gains one element; `RoomRunInjected` one optional field.

**Polling.** One `SubagentCallsStore` per client shares a read per member session; a follower says whether it still needs fresh reads (a running call, a pending card, a run row, or a settled call without a record for its first three reads) and the store polls on the room's 4 s cadence only then.

## Alternatives considered

**Reading the grandchild sessions from the browser (projections, live session subscriptions).** The host's lineage dropdown does this for its own subagents, but a card needs execution records, per-execution usage and a step summary that no projection carries; one host-side fold keeps the client a renderer and answers cold sessions from storage the same way.

**Putting the cards in local-agent's client.** Members also run outside rooms, but the card shell, its statuses and the run row live in room (the background-command card is there); a second copy of the shell would drift. A composition without room keeps the generic rows.

**Reusing the host's generic row as the fallback.** ui-tool does not export it, and a keyed entry cannot decline; deep-importing `@deepseek-ai/dsh-client-ui-tool/src/…` would bundle host internals into the plugin. The plain row covers the rare non-member session with a tool literally named `Agent` / `Task`.

**Stating 「正在…」 on the second line, as the prototype does.** The mirror writes a step only once its tools have results, so the latest written step is what the subagent did last, not what it is doing; the line shows that step without a tense.

## Consequences

- Kimi (M3) needs no client change: once its mirror writes grandchild executions with the `cli-subagent` cause, its `Agent` / `AgentSwarm` rows become cards. The Kimi argument names (`run_in_background` / `runInBackground`, `resume`, `tasks`) are read loosely and only for the pending / unsupported states; the card's facts come from the read.
- A member call's row appears in the member session only once the mirror wrote the member's step, which for a foreground subagent is usually after it finished; the run row's 「正在等子智能体」 is the live surface while it runs.
- 「打开」 opens the grandchild at its top, not at a resumed call's turn (the sidebar chat address has no turn parameter).
- Steps stop at the latest 40 (「前面还有 N 步」).
- Tests: `packages/local-agent/tests/subagent-calls.spec.ts` (the fold over the real writer's output) and `packages/room/tests/subagent-cards.client.spec.tsx` (every card state, the toolview over the store, the run row, the store's polling). Preview: `packages/room/tests/preview/subagents.html`.
