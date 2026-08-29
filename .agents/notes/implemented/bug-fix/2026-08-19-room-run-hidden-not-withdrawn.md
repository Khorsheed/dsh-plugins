# Agent Note: Room run rows hide in place — the assembler forbids null withdrawal

Status: implemented

English | [中文](2026-08-19-room-run-hidden-not-withdrawn.zh.md)

## Problem

A live field report: after a dispatched CLI member (ada) had fully answered — the `room/speech` projection already in the chat flow and the child session showing the complete reply — the "ada 正在工作…" running row (`room-run`) never converged and stayed on screen. Reloading the room made it vanish, which pointed away from the journal (the `done` edge was written, with the same `startedAt` fold key as its `running` edge) and at the live client path.

The root cause sits in the assembler contract, not the journal: `ConversationNodeAssembler.flush()`'s *incremental* path throws `conversation Definition "room-run" withdrew materialized target "chat"; return the same key with hidden visibility instead` when a Definition's `buildViewNode` returns `null` for a context that had already materialized a node. `roomRunDefinition.buildViewNode` did exactly that for `done`/`cancelled`. The throw escapes the `Notifier`'s microtask/frame flush uncaught *after* the dirty bits were cleared, while the assembler's own dirty set is left mid-loop — so from the terminal edge onward every flush of that session's chat pipeline re-throws: the running row freezes, and so does every later chat update. `replaceWindow` (open/resync/reload) has no such rule, which is why a reload masked the bug and why the pre-fix unit tests — which drove `buildViewNode` by hand and asserted `null` — enshrined the contract violation instead of catching it.

## Decision

A terminal run edge hides the row **in place**: `roomRunDefinition.buildViewNode` returns the same node (same key) with `visibility: 'hidden'` for `done`/`cancelled`, and stays `visible` for `running`/`failed`. `null` remains only for a context with no state (never materialized — withdrawal is legal there). The shared `viewNode` helper gained a `visibility` parameter; the chat snapshot builder already filters hidden nodes out of the visible list, so the rendered behavior — the row vanishes on settle — is unchanged. The host side needed no fix: the engine threads one `startedAt` from the `running` edge through `settle`, and a host-level regression test now pins the `running`→`done` pairing on that key.

## Alternatives considered

- **Keep returning null and catch the assembler throw upstream** — rejected: the throw is the host's deliberate contract enforcement (a withdrawn node would leave the incremental view builder without a removal signal), not an accident to paper over; violating definitions must flip visibility.
- **Fix the assembler to tolerate null withdrawal** — rejected: it is upstream harness code we track but do not modify, and the contract exists so view builders can diff upserts without full rebuilds.
- **Dematerialize via a fresh hidden node keyed differently** — rejected: `buildNode` enforces `node.key === context.key`; the only legal shape is the same key with `visibility: 'hidden'`.

## Consequences

- `RoomRunView`'s own done/cancelled guard is now dead-on-arrival defense (hidden nodes never render) and stays as a guard only.
- The client spec suite gained a regression test that drives the real `ConversationNodeAssembler` (`replaceWindow` with the running edge, live `append` of the done edge, `flush()`): pre-fix it throws the withdrawal error, post-fix the row folds to hidden. The hand-driven Definition assertions now expect the hidden node, not null.
- The host spec pins the fold key: a run's `done` edge carries the same `startedAt` as its `running` edge (the client's `member:startedAt` match id).
