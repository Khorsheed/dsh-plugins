# Agent Note: room dispatches every member round through the core's `run()` entry

Status: implemented

## Problem

Batch 5 (the unified execution entry, design `proposals/active/2026-11-03-unified-execution-entry.md`, outside the repo) step S5. After S4, the host `subagent` tool and the members-page composer reach a member through local-agent's single entry `run()` and its per-member ledger, but room still called the facade `start`/`resume` itself. So room chose first round vs continuation. It kept a `!controlled` branch that every provider had outgrown. A fresh member's later dispatches waited in room until the first handle was published (`freshStarts`, the `submitted` two-step release). And none of room's rounds told the core why they ran or which task they served. Their execution records said `caller: 'api'` with no cause, and a retried room delivery had no key, so nothing stopped it from being admitted twice. A member with an unreconciled execution refused room work with a bare English error. And a round the room's own agent started on a member with the `subagent` tool never appeared in the room (user decision 2026-11-03 ④ asks that it does).

## Decision

- **One entry.** `DispatchEngine.runCliMember` calls `localAgent.run()` for every CLI member round: human message, member→member message, help-in, report, release round, legacy relay, invite first task, retry, and `/compact` (`operation: 'compact'`). The request carries `caller: 'room'`, the member's stable child id, `cause`, `task`, `key`, `callerRef`, `signal`, and `on.admitted`/`on.progress`. The room facade probe (`adapter.ts`) now requires `run`. A core without it reads as "local-agent unavailable" for CLI members.
- **Stable child id.** `member.childSessionId ?? <room member id>`, the same id `prepareMember` reserves. The core creates a first round's child under it, so later rounds name the member before its handle reaches the journal. `freshStarts`, `startingMembers`, and the `submitted` hold for fresh members are deleted. `memberMode` finds a first round's asker by that id, and `cancel` reaches a first round by it.
- **No scope, cwd or model on a continuation.** `member.create` (`label`, `model`, `effort`, `cwd`) goes only on a member with no child yet. A prepared member gets only `{ label }`. A continuing member gets no `create`, and the core takes scope/cwd/model from its record (R5).
- **Lazy input.** The prompt (briefing or changes, notifications, held reports) is assembled when the core reaches the round at the head of the member's queue. A delivery that was settled while it waited (removal, move-on) or whose member was removed aborts there and journals nothing. The `!controlled` branch is gone: room's running edges are written only from `on.admitted`. If a provider publishes a run without reporting admission, room writes them when the run publishes.
- **Room's queue stays above the ledger.** The per-member submission chain is released as soon as `run()` resolves, meaning the round is durably queued. The ledger orders rounds from there. Room's own `queues`/`scheduled`, its running→uncertain recovery, and the R2 usage copy are untouched (S6/S7).
- **No double admission.** `key` = the delivery id `<dispatch seq>:<member id>` (a legacy relay: `relay:<relay ids>`), and `callerRef` = the run id. A delivery submitted twice gets the same execution back from the core. A module-level `claimed` set makes the second room run journal nothing.
- **`room/run-state.executionId`** (optional field on the registered event) is on the running edge and on every terminal edge. A run with an execution id takes `childTurn` from the execution's recorded turns. The engine uses the settlement's `turns`. Reconcile/cancel paths use the child's `local-agent/execution` end record, or the turns after its start record while it is still open. `childFromSeq` (now the core's admission value) is the range only for runs without an execution id, which are the room's own agent and pre-S5 runs.
- **`room/dispatch.releaseReason`** (optional: `timeout` | `manual` | `restart`) records why a release round woke its recipient, so its cause is a fact.
- **Refusals the user can act on.** When `run()` refuses, or a round ends before starting, because the member has an `uncertain` ledger row, the room delivery and run fail with `MEMBER_UNRECONCILED_TEXT`. That text says it was not sent and points to the edit dialog's 待对账. A paused composer queue gets `MEMBER_PAUSED_TEXT`.
- **Outside rounds show in the room.** Room watches `local-agent/execution` start/end records on `session/event`. A start whose caller is not `room`, whose parent is a live room, whose child is a CLI member's, and whose admission is under 60 s old (not a replayed log) gets a running card: run id `execution:<executionId>`, with `executionId`, `childFromSeq`, and the child id. The member reads busy, the stop button reaches it, and the recovery projection keeps it running. At the end record, room writes the reply as `room/speech` (prompt rounds) and a terminal edge with `childTurn`. Those are the host `subagent` tool and the members-page composer. No room delivery, report or task is written, because the work belongs to its caller.

## Cause and task mapping

| Room fact | `cause` |
|---|---|
| `human` dispatch (and `/compact`) | `{ kind: 'human', sessionId: room, dispatchSeq, via: 'room', messageId? }` |
| `coordinator` / `member` / `relay` dispatch | `{ kind: 'member', sessionId: room, fromMemberId: dispatch.from, dispatchSeq }` |
| `help` dispatch | `{ kind: 'help', sessionId: room, helpId: help.id, fromRoom: help.room }` |
| `report` of a delivery | `{ kind: 'execution', executionId }` of the source run. A source without one (room's own agent, pre-S5): `member` from the reporting member id |
| `report` of a help thread (`help:<id>`) | `{ kind: 'help', helpId, fromRoom: <helper session> }` |
| release round, `restart` | `{ kind: 'restart', sessionId: room }` |
| release round, `manual` (现在交给) | `human` via `room` |
| release round, `timeout` / unrecorded | `{ kind: 'decision', decisionId }` of the latest `report-timing` "later" decision for that recipient. None recorded: no cause |
| legacy confirmed relay (no dispatch) | `member`: relay sender's id (else name), `dispatchSeq` = the relay event's seq |

`task` = `{ sessionId: room, id: dispatch.task }` when the dispatch names a task. `executionFacts()` in `dispatch.ts` owns the table.

## Alternatives considered

- **Keep `start`/`resume` and only add cause/task options.** Rejected: room would still decide first round vs continuation and pass cwd on resume, and it would still need the fresh-member hold. The design's point is that only the core decides.
- **Remove room's queue now.** Rejected for this step. Room's `queues`/`scheduled` and uncertain handling go in S7 together with recovery by key. Removing them alone would leave room with no in-process dedup and no recovery path.
- **Show the refusal as an `uncertain` room delivery.** Rejected. An uncertain room delivery offers room's own reconcile ("it ran, record the result") for a round that never ran, and it blocks every later room delivery to that member. A failed row whose reason names 待对账 is accurate.
- **A core event or callback for outside rounds.** Not needed. The core already writes `local-agent/execution` into the member's session, and room already listens to `session/event`. Room shows what the core recorded, with no new seam.
- **Read childTurn from `childFromSeq` for every run.** Rejected per the design. An execution's turns are a written fact, and the seq range is the batch-4 fallback for runs that have no execution.

## Consequences

- User-visible: a refused round now reads 「没有发出：该成员有一轮被重启打断、结果不确定。请在成员编辑弹窗的「待对账」里核对并填写结果，再重新发送这条消息」 instead of an English error. A round the room's agent (or the members page) starts on a member shows a working card and the reply in the room. Two messages to a member that has not started yet both enter the core's queue at once (they no longer wait in room). The second still runs only after the first, as a continuation.
- A core without `run()` (older than S4) makes CLI members unavailable in this room version. Both live in this repo and ship together.
- Release rounds journaled before this change have no `releaseReason`. Their cause falls back to the latest hold decision, or none.
- An outside round that is still running at a restart is projected failed by room's recovery view. The core's ledger shows it uncertain, and S7 unifies the two.
- room tests use `tests/run-entry-shim.ts`, a `run()` double over the specs' scripted `start`/`resume` mocks. It keeps one strict queue per member, lazy input, key dedup, admission, and start/end records in the child. Specs keep scripting provider rounds as before.

## Testing

- `packages/room/tests/dispatch.host.spec.ts`: every round goes through `run()` with the mapped cause/task/key/callerRef (invite, member message, report → `execution`, human with `messageId`). There is a unit table for help, help reply, release `timeout`/`restart`/`manual`, a pre-S5 report, and a legacy relay. A member with an uncertain execution gets the 待对账 failure and nothing is sent. A delivery replayed by a second engine while the core holds it is admitted once (one provider call, one running/done pair). An outside `tool` round shows a running edge, speech and terminal edge, while the room's own rounds and replayed history do not. A fresh member's two rounds both reach the core under its member id, and the second continues the first. The range test now also pins `executionId` on both edges. Existing scenarios were adapted where the ledger is strictly serial.
- `packages/room/tests/jobs.host.spec.ts`: both rounds of a task name that task, with causes `human` and `member`.
- `packages/room/tests/lens-contract.host.spec.ts`: every running edge in the contract run carries a distinct `executionId`, and every prompt round's terminal edge has a `childTurn`. The fixture `packages/context-lens/tests/fixtures/room-contract.json` was regenerated with `UPDATE_ROOM_CONTRACT=1`. It adds `executionId` and shifts child seqs by the execution records. Context Lens source is untouched and its suite is green (311).
- `packages/room/tests/service.host.spec.ts`: `memberMode` names a first round's asker by its member id, including with two first starts at once.
- `packages/room/tests/real-core.host.spec.ts` runs room on the real local-agent core: the real registry with its `run()`, ledger, `MemberControls` admission and execution records, on JSONL persistence in temp directories. A fake family provider holds each round open (no CLI, no model). It covers four cases. A human dispatch is one execution: the start record has `caller: 'room'`, cause `human`/`via: 'room'`/`dispatchSeq`, `callerRef` and the ledger key `<seq>:<memberId>`, and the run-state edges carry the `executionId` and `childTurn` from the settlement. The same delivery submitted twice by a second engine is one execution, one provider round and one running/done pair. A `tool` round and a queued room round on the same member run strictly one after the other: the room shows the tool round as its own card and terminal edge, and the queued room round then continues the member. After a core restart that leaves a tool round `uncertain`, the core refuses the next room round and the room records `MEMBER_UNRECONCILED_TEXT`. Every child log it stores passes `assertReleasedV4Relationships`, and nothing is quarantined.
- room 490 → 500, all green. local-agent 518, claude-code 281, codex 278, kimi 325, dsh 246, bundle-local-agent 5, context-lens 311 are unchanged and green. `pnpm check:plugins` is clean.
- The real-core run found no defect. One thing it shows, which predates S5: a room run refused before admission has a failed run-state edge but no running edge. The room's `runs` projection keeps the member's previous run there, so the refused round shows as the failed timeline row and the failed delivery.
- Not verified: a real CLI round and a live 3080 instance. The outside-round card was not seen in a browser. The real-core spec calls `run()` as `caller: 'tool'` the way the tool does, not through the host tool runtime.
