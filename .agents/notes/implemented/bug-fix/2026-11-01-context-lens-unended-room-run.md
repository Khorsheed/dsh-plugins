# Agent Note: Context Lens — an unended room run stops at the member's next run

Status: implemented

## Problem

A room session on prod 3080 (a CLI coordinator writing a novel) opened Context Lens on a failed turn with nothing in it, and its round 36 swallowed every later request: one cell held ~150 bars, the map centered on it so nothing else was visible, and jumps to earlier rounds did nothing.

Three causes, read from the session log:

- Round 36's member run stayed at `running` forever — the restart that interrupted it never got its `done`/`cancelled` written — so it had no `endedAt` and no `childTurn`. `roomTurns` matched such a run by time span ending at `now()`, so it claimed every later request of the child session. The same requests also sat in their own rounds, so the session trend counted them twice.
- The latest listed turn was a host turn ankh-guard's restart followup started; the room's pre-step refused it before any model call. It has no request, no human message, no reply — but it was the panel's default.
- A room round lands on the human's message row (`data-chat-node-key`), and unlike a host turn it never paged the chat's history back: a round older than the rendered window could not be reached.

## Decision

- An unended run's window stops at the start of the same member's next run (else the next dispatch, else now), and requests whose host turn a later run of that member recorded as its `childTurn` are never claimed by it (`InspectorStore.openRunEnd` / `laterChildTurns`).
- `isHollowTurn` (client aggregate): zero requests, empty query, not a room round, no closing message. `latestTurnSeq`, the `resolveTurnSeq` fallback and the 回到最新 target skip hollow turns; when every turn is hollow the old latest-turn behavior stays. Hollow turns stay listed and selectable.
- A room round anchored on a human message carries `startSeq = dispatch.seq − HUMAN_MESSAGE_LOOKBACK` (the message is within that lookback by construction). `syncScrollToTurn` pages through `loadThrough` before landing on a round's row, exactly as for host turns (`hasMessageAnchor`).

## Alternatives considered

**Drop the time-span fallback for runs without a child turn.** Older logs and some producers never record `childTurn`; those rounds would turn empty.

**Hide hollow turns from the list.** They are true host turns with an error worth seeing; only the default landing moves.

**Record the human message's exact seq on the dispatch.** Precise, but needs the service to thread a second value through both the live and backfill paths; paging a dozen extra events is harmless.

## Consequences

A run whose end was lost now shows only its own requests; the trend counts each request once in this case. A session whose latest turn is a refused followup opens on the latest turn with content. Room rounds outside the rendered history are reachable. The window of an unended run that was the member's last ever run still extends to now — no later run exists to bound it.
