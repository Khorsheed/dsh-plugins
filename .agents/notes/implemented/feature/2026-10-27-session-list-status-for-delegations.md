# Agent Note: The session list shows CLI members working, done, and waiting

Status: implemented

English | [中文](2026-10-27-session-list-status-for-delegations.zh.md)

## Problem

The host's session list shows these statuses:

- 等待审批 / 待审阅计划 / 等待回答 (pending interaction);
- 运行中 (the session's own agent runs);
- 「N 个子 agent 运行中」 (children in the session's `subagentCatalog` running);
- 已完成 (a running→idle flip the user has not seen);
- idle.

`running` comes only from the host's `api-session/status`, which session-controller raises for its own agents. A CLI delegation's child session has no host agent, so a room whose members work, or a session delegating to kimi, showed nothing. A room's question and approval cards are room journal events, not host interactions, so 等你处理 never showed either.

## Decision

- **local-agent core** raises `api-session/status(childSessionId, running)` when a delegation round enters and leaves its active-run map. Both the facade's and the tool's runs go through it. The child row reads 运行中 → 已完成, and its parent's row counts it under 「N 个子 agent 运行中」.
- **room (host)** follows `room/run-state` on `session/event`, keeping a run set per room. It raises the room session's status true on the first running member and false after the last one ends, unless the room's own agent still runs. When that agent settles while members still run, room re-raises true. The list therefore shows 运行中 and then 已完成 for the room.
- **room (host)** also tracks waiting `room/question` / `room/approval` cards from the same feed and serves them through a `pendingCards` Remote.
- **room (client)** polls `pendingCards` every 4s and publishes each card through `uiSession.registerPendingInteraction`. It uses precedence −1 (an official approval wins) and keys prefixed `room:`. The composer selector no longer yields to a `room:`-keyed interaction; the official panels claim interactions by `instanceof`, so they never take these.

## Alternatives considered

**A host-sanctioned activity contribution API.** None exists yet. Raising the host's own event is a seam, filed as an upstream proposal (`docs/upstream-proposals/2026-10-27-session-activity-contribution.md`, local). Retire the seam when an official channel ships.

**Push the waiting cards instead of polling.** A plugin cannot declare a forwarded Remote event today. The poll reads an in-memory map.

## Consequences

- After a browser reload the statuses come back with the next flip. The list's baseline `running` still reads only host agents.
- While a room card waits, the host's stop shortcut is disabled in that room, as it is for any pending interaction.
- Rooms not loaded since the host started report no cards. Their cards expired with the restart anyway.
