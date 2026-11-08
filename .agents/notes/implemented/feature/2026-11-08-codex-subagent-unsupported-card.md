# Agent Note: Codex subagent spawns read 「暂不支持查看过程」

Status: implemented

## Problem

Codex runs its own subagents (multi_agent, on by default): the app-server reports each `spawn_agent` / `wait_agent` / … as a `collabAgentToolCall` item, and the subagent itself runs in another thread. The live driver folded that item into a tool row `collab/<tool>` with no arguments and no result, so the mirror wrote the interrupted-call text as its result and the member session showed an error-looking generic row with no hint of what was spawned. The member-cli-subagents design (step M8, Codex phase 1) asks for the same card the other members' subagents get, saying 「暂不支持查看过程」 — no 「打开」, no usage — until a later phase mirrors the child thread.

## Decision

- **Codex live driver** (`packages/local-agent-codex/src/live-driver.ts`, `codexAppServerItemToLine`): a `collabAgentToolCall` keeps its name `collab/<tool>` and now carries `args` = `{ prompt, model }` (when the item has them) and `result` = the reported agent states' messages, else the call's status word; `status: 'failed'` marks the call failed. Nothing about the child thread is read.
- **Room card** (`packages/room/src/client/subagent-card-view.ts`): `collab/spawnAgent` (`CODEX_SUBAGENT_TOOLS`) is registered on `tool.call.toolview` beside `Agent` / `AgentSwarm` / `Task` ([member subagent cards](2026-11-08-member-subagent-cards.md)). In a member session it is always the **unsupported** card: type 「子智能体」, the prompt's first line as the description, 「暂不支持查看过程」; never running, never polled past the first read. Outside a member session it is the plain row like the other subagent tools. The other collab calls (`wait`, `sendInput`, …) keep the generic row.

## Alternatives considered

**Mirroring the child thread now.** That is phase 2: it needs the child thread's notifications (dropped by the driver today) or `thread/read`, plus a check of what usage the app-server reports for it; the card would then become a normal single card with no client change.

**Cards for every collab call.** `wait` / `sendInput` / `closeAgent` do not start a subagent; a card per call would show one subagent several times.

**Naming the card by `task_name`.** The app-server item carries no task name (the model's `spawn_agent` argument does not reach it); the prompt is what the item has.

## Consequences

- Codex spawn rows stop reading as interrupted calls in the member session and Context Lens.
- The app-server item shape is from `codex app-server generate-ts` (codex-cli 0.163); no real member run has used multi_agent yet, so the card is verified against synthetic items only.
- Tests: `packages/local-agent-codex/tests/live-driver.spec.ts` (the fold), `packages/room/tests/subagent-cards.client.spec.tsx` (the card). Preview: `packages/room/tests/preview/subagents.html?state=codex`.
