# Agent Note: local-agent member tasks — dsh todo/write passthrough + dock tasks row (M2)

Status: implemented

English | [中文](2026-08-22-local-agent-member-tasks.zh.md)

## Problem

A dsh member's sub-instance maintains a real todo list (the todo tool writes native `todo/write` events into its session), but none of it reached the parent: the dsh mirror filtered its passthrough vocabulary to `user/message` + `assistant/message`, so the member child session never saw the member's task state, and the member dock had nothing to show beyond token stats. This is milestone M2 of the [member-state proposal](../../../proposals/active/2026-08-22-local-agent-member-state.md): the dsh passthrough proves the full chain (member CLI task state → `todo/write` on the member child session → member dock tasks row) before the per-provider translation adapters (M3–M5) exist.

## Decision

**Target vocabulary: native `todo/write`.** The sub-dsh produces official session events already, so dsh needs no translation adapter — the mirror passes the event through verbatim, and every official surface (the `todos` projection, TodoPanel in non-takeover views) consumes it for free. This is the data-layer-once decision the proposal makes: display faces read the projection, never provider formats.

**Mirror passthrough with last-wins idempotency** (`packages/local-agent-dsh/src/session-mirror.ts`): each mirror pass appends the round's LATEST `todo/write` snapshot only when it differs from the child session's last mirrored one. The message prefix skip is untouched — todo/write is counted independently, because its semantics differ: messages are an append-only stream (skip the mirrored prefix), the todo list is a standing whole-list snapshot (compare last vs last). Consequences of that split: repeated passes never duplicate an identical snapshot, intermediate snapshots never enter the child log, and a changed list lands exactly once. `DshMirrorDelta.total` counts mirrored todo snapshots alongside messages; `texts` stays message-only (a todo update is not a transcript line).

**Dock tasks row** (`packages/local-agent/src/client/member-dock.ts`): the `tasks` contributor, registered after `stats`, reads the `todos` projection (`TodoItem[] | null`, whole-list last-wins per the projection contract) and renders `任务 <done>/<total> · 进行中：<active title>` — declining when the session has no todos (unit absent, pre-first-write null, or empty list) and dropping the active segment on an all-settled list. `MemberComposer`'s projection bag gains `todos: useProjection('todos')`. The `@deepseek-ai/dsh-tool-todo` package joins the peer (optional) + dev dependency lists, type-only import pattern like the token-meter merge.

This note is separate from the M1 dock note because M2 adds a NEW decision (the translation target vocabulary and the passthrough's last-wins idempotency rule), not just a fact update — the M1 note's stated facts remain accurate.

## Alternatives considered

- **Folding todo/write into the message prefix skip** — rejected: prefix counting is stream semantics; a snapshot that repeats content would be miscounted (an unchanged list would skip wrongly, a changed one would need positional accounting that does not exist). Last-vs-last comparison matches the event's own whole-list contract.
- **Appending every intermediate snapshot** — rejected: the log would accumulate one entry per todo mutation per poll; last-wins is the semantic, so only the latest distinct snapshot per pass crosses.
- **A dsh-side translation adapter like M3–M5's** — rejected as pure ceremony: the sub-dsh's events ARE the target vocabulary; an adapter would be the identity function.
- **Waiting for a per-provider adapter to land before the dock row** — rejected: the dsh passthrough proves the full chain end-to-end now, and the row is projection-generic — M3–M5 adapters feed the same seat with zero dock changes.

## Consequences

- dsh members expose their task list in the member dock and (in non-takeover views) the official TodoPanel from one data path; kimi/claude/codex adapters (M3–M5) inherit the same seat.
- The mirror's event vocabulary is deliberately enumerated; the next event type that should cross (none planned) requires the same explicit decision.
- A todo-only change triggers a persist pass of its own — same best-effort channel as message mirroring.
- Live-driver forward-compat holds: the passthrough lives in the shared fold layer the proposal pins as the sequencing contract.

## Testing

`packages/local-agent-dsh/tests/session-mirror.spec.ts` gains the passthrough case: a `todo/write` snapshot crosses verbatim (counted in `total`, not in `texts`), a repeat pass over an unchanged log is a pure no-op (no duplicate identical snapshot), and a changed list mirrors exactly once as the new last-wins state (the intermediate snapshot never enters the child log). `packages/local-agent/tests/member-composer.client.spec.tsx` (23 tests): the tasks contributor declines with no todos and summarizes mixed states, drops the active segment when all settled, and the dock renders the tasks row below the stats row when the session carries todos (the chain unit level: projection bag → contributor → row). Suites: local-agent 146/146, local-agent-dsh 38/38, family regression green.

## Cross-references

- [Member-state proposal](../../../proposals/active/2026-08-22-local-agent-member-state.md) — the milestone plan this implements (M2).
- [Member dock](2026-08-22-local-agent-member-dock.md) — the registry this contributor plugs into (M1).
