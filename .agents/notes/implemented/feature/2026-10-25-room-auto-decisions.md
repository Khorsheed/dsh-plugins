# Agent Note: The room's own decisions are one scenario table, recorded and shown

Status: implemented

English | [中文](2026-10-25-room-auto-decisions.zh.md)

## Problem

The room calls the decision model (the optional `typesafe` service, TypeSafe System One, default `jev-latest`) in two places: filing a human message under an open task, and timing a member's report. Nothing showed either one. These calls are room code, not a model tool, so they appear in no session and Context Lens cannot see them. Only part of each outcome was journaled:
- `room/task-link` when a message joined an existing task;
- `room/report-gate` with the verdict and the rule code.

Other parts were never journaled:
- the state the room sent, the question, the probabilities;
- the model, tokens, latency and cache flag;
- failures.

Several rules also decided before the model was asked, and nothing named them.

## Decision

- **One scenario table.** `decisions.ts` holds one entry per scenario, each with its fixed question (`DECISION_SCENARIOS`), plus a shared `askDecisionModel` that never throws. Today's scenarios are `task-filing` and `report-timing`; a new one adds an entry. The question wording is a code constant. Only the state is assembled per call, from the room log.
- **Every weighed decision is recorded.** Each one becomes a `room/decision` event: `scenario`, `outcome`, the `rule` that decided or the `probability`, and `about`, which holds the message and task for filing and the from and to members for timing. When the model was asked, the event also carries `call`: the model, latency, cache flag and tokens as the service reported them; the request's state and questions as sent; the response; and a `failure` with reason and detail. Some decisions decide nothing and are not recorded: the each-setting, plan cadence, filing switched off, and filing with no open task. History is not backfilled.
- **Settings.** 协作设置 is split into 协作 and 自动判断.
  - 自动判断 has 自动任务分类 (`autoTaskFiling`, default on; off makes an untagged message a new task).
  - 自动判断汇报时机 replaces the old 回报什么时候交给对方 segment as a switch over `reportTiming` (`judge` / `each`).
  - Its box holds 立即汇报阈值 (`reportThreshold`, 0.1–0.9, default 0.5) and 最长等待时间 (`reportWaitMinutes`, 1–30, default 3), which arms the hold timer.
- **Timeline.** A `room-decision` node renders one dim line per decision, for example 「合并到任务 3 · 修导出报错 0.82 · 1.2s」 or 「bill 的结果立即汇报给 dsh（最后一个结果）」. 查看判断 appears only on a decision with a model call and opens the `context-lens` tab with `{ sessionId, roomDecision }`.

## Alternatives considered

**A separate 动态 tab in the room.** Rejected by the owner: there is too little content for a page of its own. The timeline carries the outcome, and Context Lens carries the request.

**Record only model calls.** Rejected: the owner wanted every weighed decision visible, including the rules.

**Let a model write the question.** Not done: a fixed question keeps the decisions comparable and testable.

## Consequences

- Context Lens lists the recorded model calls as requests on a 房间 tab (see [2026-10-24-context-lens-room-rounds](2026-10-24-context-lens-room-rounds.md)); rule decisions stay on the timeline only.
- Tests cover the recorded filing and timing decisions with and without a call, filing switched off, the settings ranges, the decision line, and persistence of the new event.
