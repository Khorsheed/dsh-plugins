# Agent Note: Context Lens turn window

Status: implemented

## Problem

Context Lens rebuilds a session's history from its log when the panel first reads it. Three defects surfaced together on the 3080 instance:

- **Older turns were simply gone.** The backfill kept the newest 30 turns, dropped the rest, and showed "older turns not loaded (memory budget)". The panel had no way to see them.
- **A newly opened session could load nothing.** All backfill shares one 150M-character budget, and a candidate turn could only take free room — never another session's backfill. After a few long sessions had been opened, every later session showed zero turns next to the budget hint.
- **A long log could exhaust the server's heap.** Every reconstructed request stores its whole context, so rebuilding a log materializes the same history once per request. A 151-turn session with 1,859 requests (28 MB of log) ran a 4 GB heap out of memory during reconstruction, before any window was applied.

## Decision

- **A movable window of 30 turns.** `InspectorStore.setWindow(sessionId, end)` drops the session's backfilled turns (live turns stay) and records the window's newest host turn; the next read refills the 30 turns ending there, or the latest 30 when `end` is absent. The `loadTurns(sessionId, end | null)` Remote verb does both in one call and answers the new turn list. `ListTurnsResult.range` gives the log's first and last host turn, so the panel derives the runs it has not loaded.
- **Live turns and the window are capped separately.** At the latest, live turns the log does not hold yet still take window slots, as before. A window moved to older turns never pushes live turns out, and live growth never pushes the window out.
- **Only the window is materialized.** The service lists the log's host turns first, asks the store for the window (`windowHosts`), and passes a predicate to `reconstructSession`. Requests outside the window keep their structure (numbering, responses, tool pairing) without copying their context. The first materialized request after a skipped one diffs against the skipped request's message list, so history/added stays correct. Compaction calls follow the predicate through their host turn.
- **Loaded turns stay contiguous.** The fill runs newest-first and stops at the first turn that does not fit (request cap or character budget). Unloaded turns are therefore always older than the loaded run, and paging back always makes progress. When the newest turn in the window does not fit at all, it is skipped instead, so one oversized turn cannot pin the window.
- **The least recently read session yields room.** Each session records when a panel last read it. When a candidate does not fit, other sessions' backfilled turns are evicted, least recently read session first and oldest turn first, until it fits. Live content never yields. A session that lost backfill this way, or through the global budget, drops back to `partial` and refills when next read. Window moves and cross-session evictions do not count toward `evictedTurnCount`, and they keep the session record (with its window) even when it empties.
- **Panel.** The budget hint is gone. Each unloaded run appears in the session map as a narrow cell with its turn range at its position; clicking it loads 30 turns in that direction. The turn menu lists the same runs as "load turns a–b" rows. The ‹ / › arrows continue across the window edge by loading the adjacent window. "Latest" reloads the newest window when it is not loaded. The switcher reads `N / last` against the whole log, and the button reads "Back to latest".
- **Jumping to a turn the chat has not rendered.** The conversation scroll-sync lands on the chat's `[data-chat-turn]` rows, but the chat renders only its loaded history, so a turn from an older window had no row. Each turn now carries its `turn/start` log seq (`TurnListItem.startSeq`, from the log row or the live event). When the target row is missing, the panel first calls the session's own history loader, `ctx.sessions.binding(sessionId).session.loadThrough(seq)` (the one message-timeline uses), then lands once the row mounts. It waits at most 60 frames; a newer jump supersedes a pending one, and no progress falls back to the nearest rendered turn.

## Alternatives considered

**Raising the turn cap.** Memory grows faster than the request count because each request stores its own copy of the history, so a higher cap only moves the failure. The reconstruction blow-up happens before any cap applies.

**Hiding the hint and trimming silently.** A session would then appear to have only its last 30 turns.

**Loading the whole session on request.** Long sessions are exactly the ones that cannot fit.

**Skipping turns that do not fit and filling older ones (the previous rule).** It leaves holes inside the loaded range. Clicking a hole reloads the same window with the same holes, so paging back never makes progress.

## Consequences

- Moving the window re-reads and decodes the log once, the same cost as the first backfill. For the 151-turn session above, a move takes 3–7 s.
- A session whose requests are near a million characters each shows only a few turns per window, because the global budget still bounds what is resident. The map then shows the rest as one run to page through.
- Opening a session can evict another session's backfill. Returning to that session costs one more log read.

## Testing

`tests/store.spec.ts` covers:
- the window at a set end and back at the latest, without counting evictions;
- contiguous fill and the oversized-newest-turn skip;
- room taken from the least recently read session, which then reports `partial`.

`tests/client-panel.spec.tsx` covers the unloaded-run cell, the newer-direction window it requests, and the `N / last` switcher label. `tests/client-wire-arity.spec.ts` pins the new verb's arity.

A run against the 151-turn, 1,859-request session completes without exhausting the heap. The latest window loads turns 147–151; the window ending at turn 100 loads turns 89–100; both are contiguous.
