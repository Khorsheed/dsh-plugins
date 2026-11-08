# Agent Note: Context Lens shows a member CLI's own subagents

Status: implemented

## Problem

A member CLI (Kimi `Agent`/`AgentSwarm`, Claude Code `Agent`/`Task`) runs subagents of its own. local-agent mirrors each one as a grandchild session under the member's child session (member-cli-subagents M2–M4): a catalog row on the member, a `local-agent/execution` per call whose cause is `cli-subagent` (the member's `callId`, the member execution it ran in, its type, swarm place, background and resume flags). Context Lens read one level only: a child's catalog rows were never followed, so a subagent's requests, cache and time were invisible, both in the room lens and in the member's own lens, and a round's totals left out what its subagents spent.

## Decision

Context Lens follows a member's catalog rows one level further and places every subagent by its execution records. Nothing in the look changes; the existing views gain content.

- **Reading.** The log lane's fold reports every `subagent/catalog` row (`FoldSink.catalog`). For an external member (its descriptor's provider runs out of process), the service opens a hidden grandchild scope beside the member's (`InspectorStore.noteGrandchild`), and reads its log in the same query (a second refresh pass), so its requests and execution records arrive together. A live catalog row on a member's own session does the same. A host-native child's nesting stays unshown. Child-log cursors and handles are keyed per opened session (`<root>\0<child>`), because the same grandchild is a view of both the room and the member's own lens.
- **Placing.** A stored grandchild is a CLI subagent once its log holds a `cli-subagent` execution. On read, each such execution is claimed by the view of the turn whose records name it, on the member session the cause names: the member execution it ran in (`cause.executionId` among the view's runs or requests) or the member request that issued `cause.callId`. Never by time or order; a grandchild whose records are missing is not placed. One tab per subagent per turn, holding only the claimed executions' requests, so a resumed Kimi subagent shows in each turn that called it, with that call's requests. In a room round the tab reads 「member › type」 right after the member (or after a self-started round that called it); in the member's own lens it reads 「type」 after 主对话. Several of one type under one view are numbered (an `AgentSwarm` by its place). A member CLI subagent no listed round claims shows in 未归轮.
- **Pairing.** The view carries `cliSubagent` (caller view, call id, swarm place, background, resumed) and `delegatedBy` (the caller's request whose call started it). The tabs row says 「由 X #n 派出」 with the jump back; the caller's request row and its output carry 「派出 X →」.
- **Status.** From the claimed executions' end records: no end → running; `failed` → failed; all `done` → ok; otherwise (`cancelled`, `uncertain`) → stopped (`cancelled`). The execution note reads 起因：成员的 CLI 派出 / 续用的子智能体.
- **Timing.** Each subagent is one more lane 「› type」 after its caller on the shared clock, with thin dashed marks at its run's start and end; the caller's tool-call segment is titled 「等 type」.
- **Totals.** A turn's totals count every view once; `TurnListItem.subagents` states the subagents' part (requests, input, output), already inside the totals, and the turn menu row says it. The session map draws a subagent's requests in its caller's turn, outlined dashed.

## Alternatives considered

**Pair the catalog row to the member's `Agent` call by order (the existing FIFO binding for `subagent_*`).** A Kimi swarm writes three catalog rows for one call, a resume writes none, and the mirror may write the catalog row before or after the call's step; order is a guess. The execution records name the call and the member execution directly (batch-5 S8: lens reads written facts, never infers).

**Store the grandchild scope in the turn whose catalog row opened it.** A resumed subagent runs in later turns; the catalog row is written once. Placing per execution on read keeps each call's requests in the turn that made it.

**A merged 「全部」 request list across agents.** Withdrawn in the design (user decision 2026-11-06): the existing tabs and timing lanes already carry multi-agent progress.

## Consequences

- The room lens and the member's own lens show what a subagent did, request by request, with the same detail as the member; its time sits on the member's timeline.
- The turn's numbers include subagent spend without double counting, and say how much of it is the subagents'.
- Old member logs (no grandchild sessions) read exactly as before. A grandchild log whose records are cut shows nothing extra in a room round; in the member's own lens it stays a plain catalogued child.
- Grandchild logs are read for every external member on every refresh that reaches them: one more incremental read per subagent.

## Testing

- local-agent `tests/lens-contract.spec.ts` generates `context-lens/tests/fixtures/local-agent-cli-subagents.json` through the real `openCliSubagent` writer: a foreground subagent, a three-way swarm (one cut off) and a resume in the next round (`UPDATE_LOCAL_AGENT_CONTRACT=1` regenerates it).
- context-lens `tests/cli-subagents.spec.ts` replays it through the real service: room tabs, member-lens tabs, pairing by call, resume per turn, totals, timing lanes, both views reading the same logs, and no placement without records. `tests/client-cli-subagents.spec.tsx` covers the tab order and relation line, the 「派出 X →」 link, the timing lane and marks, the dashed map bars and the turn-menu line.
- Preview: `examples/workbench/cli-subagents.html?view=<room|member>[&round=2]`.
