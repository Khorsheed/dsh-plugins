# Agent Note: Context Lens shows a member's self-started rounds, and titles turns without the room's preamble

Status: implemented

## Problem

This is step M8 of the design `proposals/active/2026-11-06-member-self-started-rounds.md` (gitignored). Step M4 ([kimi-self-started-rounds](2026-11-06-kimi-self-started-rounds.md)) made a round that Kimi opens on its own, after a background task ends, into an execution. Its start record has caller `cli` and cause `{ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId, startedBy? }`, and it copies the `task` of the execution that started the task. Lens did not read that cause. A real room on 3080 showed two problems:

1. **The self round was missing from the room lens.** A room dispatch ran the Kimi member, and that round started a deployment in the background. When the deployment ended, Kimi opened a round of its own. The room wrote a run for it, `execution:<id>`, which has no dispatch seq. Lens only places runs that carry a dispatch seq, so the round's requests appeared in no room round and not in 未归轮 either.
2. **A member turn was titled with the room's preamble.** The room puts injected sections in front of the human's message: 【房间简报】, the coordinator handoff 「你现在是本房间的协调者。【协调者交接】…」, 【房间变动】, 【通知】 and held reports. The member's lens used the start of the prompt as the turn title. The title then read like a handoff, and the turn looked merged with the previous one.

## Decision

**Room lens: a self round sits under the round whose run started its task** (`store.ts` `roomSelfRounds`, `addSelfScopes`).

- The placement follows the recorded chain and never time. `startedBy` names the execution that started the task. When that execution is itself a self round, lens follows its `startedBy` in turn, until it reaches the first execution that is not one. The listed room round whose run IS that execution claims the self round.
- The self round is shown as one more tab beside the member, with scope id `self:<executionId>`. Its label is 「kimi · 后台任务完成后继续」. When the round holds several self rounds of one member, each label ends with its position (`… 2`). The tab reuses the member tab's list, detail and timing views.
- The 耗时分布 view lists it as its own lane under the same name. A turn's timing lanes now carry the scope id of the view that holds the request, not the request's home scope; this also gives a room round's 压缩 tab its own lane.
- Its requests are the ones its own execution records name (`executionRequests`). They count toward the round's request count, token totals, end time and bars on the session map. The map has no separate convention for non-main scopes: it draws every request of a room round, so no style was added.
- Its member view shows the cause line 「起因：后台任务完成后继续（成员自己开的一轮）」. The text varies with the task status: 失败后, 超时后, 被终止后, otherwise 结束后. The tabs row shows 「由 #N 启动的后台任务 · 回到 #N ↩」, which jumps to the starting request in this round's view.
- When no round claims the chain, the self round goes to 未归轮 as the same kind of tab. This covers a self round with no `startedBy`, one started by a members-page round, and one started by an unrecorded round. In 未归轮, the self round's compactions stay in the group's existing 压缩 tabs and are not listed twice.

**Member lens: the self round stays its own turn and says why it ran.**

- `reconstructSession` marks a turn that opens inside a `self` execution (`LogTurn.selfCause`). It checks the open execution at `turn/start`, and the turns listed by the end record.
- The turn row carries `continues: { taskId, taskStatus, startedBy? }`. The header line shows 「后台任务完成后继续」, and so does the turn menu, because such a turn has no human message.
- The main view's tabs row shows 「由 #N 启动的后台任务」 and 「回到 #N ↩」, the existing Relation jump.

**Where the task was started** (`startingRequest`). Among the starting execution's requests, lens takes the one whose tool result names the task id; that is the CLI's own answer to the call that started the task. If no tool result names it, lens takes that execution's first request and says so: 「后台任务由 #N 开始的那一轮启动」. If `startedBy` is absent, or its requests are not loaded in this view, lens shows no jump.

**Titles without the room's preamble** (`messages.ts` `stripRoomPreamble`). The function applies to the log-lane query, the live query and a room round's line. Room writes no structured marker for these sections; lens has no dependency on room and reads them by shape. Leading `\n\n` sections that start with one of room's literal heads are dropped, and so are leading `<system-reminder>…</system-reminder>` blocks. The heads are 【房间简报】, 【协调者交接】, 你现在是本房间的协调者。, 你的指令更新为：, 【房间变动】, 【通知】 and 【#mN 的回报. The last section is never dropped, so a message that is entirely preamble, such as a report, stays as it is. A member dispatch's envelope (【来自 X · #m3】) belongs to that message and is kept.

## Alternatives considered

- **Place the self round by the room's `execution:<id>` run and its time.** Rejected: that is inference by time, which S8 removed. The chain of start records is a recorded fact.
- **Fold the self round's requests into the member tab of the claiming round.** Rejected: that is the same merge the 11-01 Kimi fold caused and M4 undid. The self round is a separate execution with its own cause.
- **Have room write a structured marker for its preamble.** This would be more robust, but it is outside this step's package (context-lens only) and would only help new logs. It can be added later; the shape-based reading stays as the fallback for old logs.
- **Always number the tab (「… 1」).** Rejected: a lone 「1」 reads like a count. The number appears only when it tells several self rounds apart.

## Consequences

- The room lens now shows each Kimi self round inside the round that caused it, and the round's numbers include its spend. A self round whose chain is not recorded shows in 未归轮, so it is visible somewhere.
- In the member's own lens, the self turn explains itself and links back to its start. Turns of the dispatch rounds read as the human's words.
- Rollback is lens only. Without this change, self rounds disappear from the room lens again and titles show the preamble. No data is written.
- Not verified on a live 3080 room. The room's M5 changes (the `continues` speech field and the follow-up report) do not affect lens.

## Testing

- `packages/context-lens/tests/self-started-rounds.spec.ts` (new):
  - `stripRoomPreamble`: the handoff, the brief, changes, notices, a held report and a system reminder are dropped; an all-preamble message, a plain message, a member envelope and paragraphs of the human's own text are kept.
  - Room: the self tab beside the member, with its requests, its continues/startedBy and the cause facts. The round's count, end time, bars and timing include it, and it is absent from 未归轮.
  - Room: a chain through a second self round, numbered 1 and 2; with no tool result naming the task, the jump goes to the starting round's first request.
  - Room: an unclaimed or unlinked chain goes to 未归轮; an unrecorded round keeps its fallback.
  - Member: turn 2 is titled with the human's words; turn 3 carries continues and the jump to the request whose tool result names the task, on the turn row and on the main view. Without `startedBy` there is no jump.
- `packages/local-agent/tests/lens-contract.spec.ts`: the generator now also drives a round that starts a background task and an `admitSelf` round. The fixture was regenerated with `UPDATE_LOCAL_AGENT_CONTRACT=1`.
- `packages/context-lens/tests/local-agent-contract.spec.ts`: replays that log. The room round shows the self tab with the jump to the request whose tool result names `bash-1`. The member's own turn 4 carries the same facts.
- `examples/workbench/self-rounds.tsx` keeps one stable tab info object. A fresh `AbortController` signal on every render re-ran the panel's request effect on every render, so clicking a tab froze the page; `room-records.tsx` still has that problem, which only affects the preview.
- Screenshots at 1280 and 390 from `examples/workbench/self-rounds.html` (`view=room|member`), saved to `/tmp/m8-lens/` and not committed.
