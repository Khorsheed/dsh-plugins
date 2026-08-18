# Agent Note: ui-shortcuts Escape retract-first pause

Status: implemented

English | [中文](2026-08-19-ui-shortcuts-escape-retract-first.zh.md)

## Problem

The shortcuts plugin's pause action (default `Esc`) only did anything once the session's turn was running: `if (!snapshot.running) return` made the key a no-op in the send-to-first-token window, and when a turn *was* running it cancelled that running turn — even when the user's intent was to pull back a message they had just sent while the agent was busy. The user-facing ask: after sending, if the agent has not started on the message yet, Escape should retract the sent message back into the input box.

## Decision

**The pause action becomes retract-first.** On dispatch it reads the current session's conversation snapshot and splits into two arms:

1. **Retract arm** — while the just-sent message is still pending in the host inbox (`snapshot.queue` rows with `placement: 'queued'`; the agent has not claimed it into a turn: queued behind a busy turn, during maintenance, or across cancel convergence), remove the **most recent** pending send through the public `conversation.updateQueue(id, { kind: 'remove' })` and return its text to the composer through `conversation.input.for(scope).setDraft`. Text-only messages restore their full text; image-only messages (`text === null`) are removed without a restore; a live non-empty draft is never clobbered (the composer's send-failure restore discipline). The running turn, if any, is left untouched — today's behavior of cancelling a busy turn when the user just wanted to undo a queued send was the footgun this fixes. Each press undoes one pending send; a second press falls through to the stop arm.
2. **Stop arm** — once nothing is pending, cancel the running turn through the scope-addressed `conversation.cancel()` (the composer Stop-button action), with the same ordinary/continuable/one-shot visibility rules as before.

A retract that races the claim (the host picked the message up between the snapshot read and the removal — `queue-item-not-found`) falls through to the stop arm with a fresh snapshot: by then it is a running turn, and cancel is the only lever.

## Why the boundary (already-admitted messages are out of reach)

The user's scenario also covers "the request was sent but nothing has replied yet". That case is **not** retractable client-side. Trace of the host admission path (`packages/core/agent-loop/src/agent.ts`): `followup` → `send(message, 'next-turn', true)` → `inbox.splice` + `wakeDriver()` → `setPhase('running')` → `withInitiator(this, () => this.kick())` (synchronous) → `turn()` → `preStep` → `inbox.claim` — the claim happens synchronously inside the `prompt` RPC handler, before the response even returns. The `user/message` event is appended the moment the turn starts, so an admitted message is durable in the session log; `updateQueue` only addresses messages still in the inbox, and no host verb removes a logged user message. Retracting an admitted message would need host-side support (a new capability or event type) and is deliberately out of scope for this plugin; the README's Known Limitations states it. The message-tools plugin's withdraw is a different semantic (surface hiding via a replacement event, requires that plugin installed) and was not reused here.

## Alternatives considered

**Time-gated retract (client-side recency tracking).** Only retract a pending message sent within the last N seconds, so Escape on a stale queued message still stops the running turn. Rejected: it needs the plugin to track send times (a snapshot subscription keyed by session) for a corner case, and queue rows carry no timestamp to derive recency from; the undo-last-send semantics is predictable without it, and a second press reaches the stop arm anyway.

**Retract every pending queued message at once.** Rejected: with several queued sends, one Escape would destroy content the user may want; per-press undo is the safer, undo-like shape.

**A separate `retract` action with its own key.** Rejected: the retract is the same "stop the most recent activity" gesture as pause, and two actions on the same chord cannot coexist (first registration wins). Enhancing the pause action keeps one key, one semantics, one settings row.

## Consequences

On a busy session, Escape now undoes the just-sent queued message instead of killing the running turn (a real footgun fixed); on an idle session with nothing pending it behaves exactly as before (no-op, or cancel once the turn is visibly running). The action still rides public services only — `conversation.updateQueue`, `conversation.cancel`, `conversation.input.setDraft` — and the test bench now exercises the retract arm (most-recent selection, restore, no-clobber, image-only, claim-race fall-through) plus the unchanged stop arm. The zh/en locale copy, both READMEs, and the Known Limitations note were updated in the same change.
