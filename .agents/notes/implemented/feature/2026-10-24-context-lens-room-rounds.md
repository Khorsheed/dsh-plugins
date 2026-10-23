# Agent Note: Context Lens room rounds

Status: implemented

## Problem

In a room session the main conversation stops running turns once another member coordinates: a human's message to the room becomes a `room/dispatch`, and the work runs in the members' own child sessions. Context Lens grouped everything by main turn, so after the coordinator handoff the panel showed nothing new. The member runs were invisible, and the children catalogued outside any turn were dropped by the backfill.

## Decision

- **A round per human dispatch outside a main turn.** The store keeps the room plugin's events per main session (`noteRoomEvent`, read structurally in `src/room.ts`, from the log backfill and the live lane alike). Every `room/dispatch` with `origin: 'human'` whose time falls outside every main turn's span is listed as a turn of its own: the query is the message, `room.targets` the members it went to, and the turn address is `-1_000_000 - dispatchSeq`. Rounds are built on read; nothing extra is stored.
- **A round holds exactly the runs it started.** Runs come from `room/run-state` (`runId` `<dispatchSeq>:<memberId>`). Each run's view is its child session's scope, under the child's own scope id, holding only that run's requests: the child turn the run recorded (`childTurn`), else the requests started within the run's span (±2 s). The child is `childSessionId`, else the subagent catalogued closest to the run's start (within 10 s). A run with no child yet shows as an empty view.
- **Children outside turns are kept.** `reconstructSession` gathers delegations it cannot place in a turn into one hidden holder (`purpose: 'room-members'`); the store files their scopes in a hidden turn that is never listed, so child requests still land and the rounds can slice them. Live catalog events outside a turn go to the same holder.
- **One numbering for the session.** Main turns (loaded or not, from their log spans) and rounds are numbered together by time (`TurnListItem.ordinal`, `ListTurnsResult.total`). Unloaded runs come from the store in that numbering (`ListTurnsResult.unloaded`, with the host turns at their ends for window moves). The map, the query line, the turn menu, the `N / total` switcher and the ‹ / › stepping all use it; window loads still address host turns.
- **The map.** A round's member requests stand where the main turn's would. Coordinator handoffs (`room/coordinator`) draw a dotted line labeled "<name> takes over" before the first turn after them.
- **Unknown cache hit.** A request whose usage has no `cacheReadTokens` shows its hit rate as "—" and its map bar grey, instead of 0 % red. Some producers (codex, claude-code) do not report cache reads yet.

## Alternatives considered

**Showing member runs only inside the main turn that set up the room.** The runs happen hours later and would pile into one turn.

**Numbering rounds separately (R1, R2…).** Two sequences on one map read as two conversations; the user chose one sequence by time.

## Consequences

- Turn numbers in the panel no longer equal the host's turn numbers in a room session; elsewhere they still match.
- Without `childTurn`, two runs of one member that overlap in time share requests. The room plugin is adding `childTurn` on `done`.
- Rounds are not windowed; a room with hundreds of dispatches lists them all.

## Testing

`tests/room-rounds.spec.ts` covers the hidden holder, rounds numbered with main turns, the handoff, slicing a run by span and by child turn, the trend rows, and skipping dispatches made inside a main turn.
