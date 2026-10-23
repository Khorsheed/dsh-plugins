# Agent Note: Room report gate — a decision model picks when a report is handed over

Status: implemented

## Problem

In a real room (inviting Claude Code, Kimi and Codex to say hello) every greeting reached the human three to four times: the member's own speech row, a summary table the coordinator made after `sleep 45` plus `room_read`, and then one full coordinator turn per report, each repeating the table. Every report woke the coordinator on its own, nothing told it the human had already read the replies, and nothing told it the reports would come by themselves. Each finished task also added a 「✓ kimi 完成了「…」—— 目标进度 3/3」 line repeating the whole request (with a progress figure computed at render time, so every line said 3/3).

## Decision

**A gate decides only WHEN a report is handed over** ([report-gate.ts](../../../../packages/room/src/report-gate.ts)); what the recipient says or does next stays its own call. When a delivery that reports back settles, rules answer first — the `each` setting, a failed or uncertain outcome, the last outstanding result, plan work, or no usable decision model all hand it over now. Otherwise the optional `typesafe` service (probed by name; room takes no dependency) answers one yes/no question, `deliver_now`, from a state holding the human's request, the notes the recipient attached when it dispatched (`note` on `room_message` / `room_invite` / the bridge tools: 「三位都打完招呼再一起跟用户说」), how long the human has waited since its last message without an answer, the progress of the batch (done / total / who is still running and for how long) and the arrived results. Below 0.5 the report is HELD.

**A held report is never lost, and never costs a turn of its own.** It is journaled as a `room/dispatch` with `held: true` and a `room/report-gate` hold verdict, and rides the recipient's next round: the room's own prompt carries every held report ahead of the round's text, so one wake delivers them all. A turn the room did not start — the human talking to the room's agent or to a native member directly — gets the held reports prepended on its first step through the public `agent/pre-step` seam. They are deliberately NOT pushed into the agent inbox: the host runs one turn per queued `next-turn` message, so the first shipped build (inbox push without wake) turned three held greetings into three coordinator turns on 3080. Holds close (`release`, reason `carried`) when they are carried; a release with nothing else to deliver — the human's 「现在交给 dsh」 (`releaseReports`), the three-minute timer, or a restart (timers are per process; `recover` runs on every live access, so it releases only holds whose timer this process does not own) — dispatches one short round that carries them.

**Less repetition by contract.** Report envelopes say 「这条回复用户已在房间里看到，不要复述」; the briefing tells members to end their turn after dispatching instead of `sleep` / `room_read` polling, to use `note`, and not to re-summarize reports; `room_message` / `room_invite` results say the same. Task-board rows opened by a message no longer render the completion line — the member's reply card stands for it.

**Presentation.** Member speech is a conversation entry: a member-color avatar beside a light card (header: name, public role, provider, time; markdown body with the existing long-reply fold; quiet footer: copy, session link, duration, 「→ 已汇报给 X」). The 协作设置 block uses the host `DisclosureRow` (full-row toggle, the current values as its collapsed summary), `SegmentedControl` and `Switch`, and gains 「回报什么时候交给对方：决策模型判断 / 每条都交」 (`room/settings.reportTiming`, default `judge`). A dashed 「📥 dsh 的收件箱里有 N 条回报…」 line with the model's probability and a 现在交给 button shows while reports are held.

## Alternatives considered

**Wait until every result of a turn is in, then wake once.** Rejected by the owner: serial work (implement, then hand to review) must move as soon as the first result lands. The coordinator's own `note` plus the model replaces any fixed rule; members can also hand work to each other directly.

**Let the decision model also choose the reply depth (act / brief / silent).** Rejected by the owner: what to do next is the coordinator's judgement; the gate only times the hand-over, and the envelope asks for no repetition.

**`join` / `each` dispatch flags.** Replaced by the free-text `note`, which carries the same intent and more.

**Speech bubbles.** The owner chose light cards: several agents take turns in a room and cards block each turn off, while bubbles squeeze code blocks and tables.

**A report joins a running round.** A report delivered to the room's own agent bypasses that member's dispatch queue and, when the agent is mid-turn, is steered into the turn's next step (`agent.steer`, `next-step`) instead of queuing a follow-up turn. Queued behind the round, it woke a second turn after the agent had already answered — seen when a model ignored the no-poll rule, read the reply itself and answered, then answered the report again. An idle agent still gets its own turn.

## Consequences

- A room whose profile has no configured `typesafe` behaves as before for timing (every report is handed over), but still gets the no-repeat envelope and the no-poll wording.
- The room's own agent's replies keep the host's assistant presentation; only member speech is carded.
- Tests cover the gate rules and model verdicts, an early result held in the coordinator's inbox (with the dispatcher's note and the batch progress in the judged state) and released by the last result, a manual hand-over, an immediate hand-over on a high probability, the inbox line's fold, the hidden completion line, the carded speech and the host-component settings.
