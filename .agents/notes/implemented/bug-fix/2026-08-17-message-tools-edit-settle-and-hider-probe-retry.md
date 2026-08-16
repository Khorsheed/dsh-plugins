# Agent Note: message-tools edit settle wait keys on turn/end, and the DOM hider probe retries within a bound

Status: implemented

English | [中文](2026-08-17-message-tools-edit-settle-and-hider-probe-retry.zh.md)

## Problem

Two defects surfaced on the 3080 production instance after the message-tools migration into this repo.

**Edit-cancel race → INVALID_REQUEST.** In session `session-bd44b8c0` a running turn had four tool calls in flight (seq 1361-1364) when the user edited an earlier message. The edit's replacement landed at seq 1366, but the cancelled tool *results* persisted at seq 1368-1372 — outside the shadowed span — and `turn/end` landed last at seq 1374. The leaked orphan tool messages made the DeepSeek API reject the next request ("Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"), surfacing as「本轮运行失败」. The client's settle wait (`waitIdle`) only watched `snapshot.running` flip false, which happens before the teardown writes land.

**DOM-hider probe one-shot degradation.** The console warning "data-chat-flow-key rows not found; full-span chat hiding disabled" appeared on page loads restored onto the trace tab (or before the chat area mounted): the first non-empty rule set's probe found no rows and disabled the hider permanently, leaking every withdrawn/edited span (withdrawal placeholders, edit trigger messages) into view. The upstream attribute was still present — the probe timing was the defect.

## Decision

**The settle wait keys on the cancelled turn's teardown fully landing, not the `running` flip** (`packages/message-tools/src/client/edit-in-place.ts`):

- `turnSettled(snapshot)` is true only when `running` is false AND `runningCalls` is empty AND the latest turn in `chat.timeline.turnOrder` has a `closed` timeline location — the `turn/end` event is written after every tool result, so a closed turn proves the whole teardown is durable. An empty turn order means the running turn's `turn/start` has not streamed in yet: not settled. Only the *latest* turn must be closed; a historically unclosed turn cannot deadlock the wait.
- `waitForTurnSettled(read, options)` polls that predicate with a 5s bound (100ms interval, injectable clock/sleep for tests) and REJECTS on timeout. A session binding that vanished cannot prove the settle and is rejected the same way. `editInPlace` never edits after a failed or timed-out settle — the rejection surfaces as the existing「编辑失败」inline error.
- The slot wiring (`src/client/index.ts`) now reads the predicate off the live session snapshot instead of the old `running`-only loop.

**The hider probe retries within a bounded window instead of deciding on one frame** (`packages/message-tools/src/client/dom-hider.ts`):

- A missed first probe starts a retry: a `MutationObserver` on `document.body` (childList subtree plus the `data-chat-flow-key` attribute filter) waits for the first chat row, with a deadline timer (default 10s, injectable via `installDomHider(ctx, { probeRetryWindowMs })`).
- Rows appearing inside the window pass the probe and apply the pending rules; only a window that expires with rows still absent disables the hider, with the same single `console.warn` and the same never-throw discipline. The observer OUTLIVES the disable: a row appearing later (the production repro sat on the trace tab past the 10s window, then the user switched back to the chat tab) proves the miss was mounting timing, and hiding reactivates instead of leaking the spans for the rest of the page lifetime.

## Verification

Unit tests pin the production ordering: `running` flips first, cancelled results land next, `turn/end` last — the wait resolves only after the final stage, and `editInPlace` edits only then; timeout and vanished-binding both reject without editing (`tests/edit-in-place.client.spec.ts`, plus the rewritten settle-shaped bench in `tests/apply.client.spec.ts`). Hider tests cover late-mounting rows recovering within the window and disable-only-after-expiry (`tests/dom-hider.client.spec.ts`). `pnpm build` + `pnpm test` for the package pass (165 tests). On the 3080 instance (0.4.8 tarball): editing the earliest user message mid-run no longer produces INVALID_REQUEST, the regeneration succeeds, no「上下文注入 message-tools」row leaks, and reloading onto the trace tab then switching back to the chat tab keeps the hidden spans hidden.

## Alternatives considered

**Wait a fixed delay after the `running` flip.** A guess, not a signal: a slow host or many tool results overrun any constant, and the failure is silent context corruption. The timeline location is an authoritative, already-projected signal.

**Wait for every turn in the window to close.** A historically unclosed turn (an ancient crash) would deadlock every later edit; only the cancelled — latest — turn's teardown races the edit.

**Treat a vanished session binding as settled (the old behavior).** That is precisely the state where nothing is proven; rejecting is cheap (the edit target's session is gone anyway) and never races.

**Disable the hider on the first miss but re-probe on every later snapshot.** Snapshot storms would then query the DOM per emission; the MutationObserver fires exactly when the DOM changes, and the deadline keeps the failure mode bounded.

**Probe the chat container's mount state instead of retrying.** There is no documented container anchor to probe against — the retry needs no new DOM assumption beyond the attribute it already depends on.

## Consequences

An edit against a running turn now waits for real durability before computing the replacement span, at the cost of up to 5s of additional latency in the pathological case (which then fails loud instead of corrupting the context). The hider survives page restores onto non-chat tabs at the cost of one MutationObserver per page lifetime that stays until the first chat row appears (disconnecting on probe success or on dispose). The pack-dist leftover guard now skips no-op self-rewrites (source name already at the dist scope), which the post-migration repo state requires — that tooling fix rides in its own commit.
