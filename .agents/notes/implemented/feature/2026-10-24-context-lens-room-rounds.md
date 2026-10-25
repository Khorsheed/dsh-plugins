# Agent Note: Context Lens room rounds

Status: implemented

## Problem

In a room session the main conversation stops running turns once another member coordinates: a human's message to the room becomes a `room/dispatch`, and the work runs in the members' own child sessions. Context Lens grouped everything by main turn, so after the coordinator handoff the panel showed nothing new. The member runs were invisible, and the children catalogued outside any turn were dropped by the backfill.

## Decision

- **A round per human dispatch outside a main turn.** The store keeps the room plugin's events per main session (`noteRoomEvent`, read structurally in `src/room.ts`, from the log backfill and the live lane alike). Every `room/dispatch` with `origin: 'human'` whose time falls outside every main turn's span is listed as a turn of its own: the query is the message, `room.targets` the members it went to, and the turn address is `-1_000_000 - dispatchSeq`. Rounds are built on read; nothing extra is stored.
- **A round holds exactly the runs it started.** Runs come from `room/run-state` (`runId` `<dispatchSeq>:<memberId>`). Each run's view is its child session's scope, under the child's own scope id, holding only that run's requests: the child turn the run recorded (`childTurn`), else the requests started within the run's span (±2 s). The child is `childSessionId`, else the subagent catalogued closest to the run's start (within 10 s). A run with no child yet shows as an empty view.
- **Children outside turns are kept.** `reconstructSession` gathers delegations it cannot place in a turn into one hidden holder (`purpose: 'room-members'`); the store files their scopes in a hidden turn that is never listed, so child requests still land and the rounds can slice them. Live catalog events outside a turn go to the same holder.
- **One numbering for the session.** Main turns (loaded or not, from their log spans) and rounds are numbered together by time (`TurnListItem.ordinal`, `ListTurnsResult.total`). Unloaded runs come from the store in that numbering (`ListTurnsResult.unloaded`, with the host turns at their ends for window moves). The map, the query line, the turn menu, the `N / total` switcher and the ‹ / › stepping all use it; window loads still address host turns.
- **The map.** A round's member requests stand where the main turn's would. Coordinator handoffs (`room/coordinator`) draw a dotted line labeled "<name> takes over" before the first turn after them. Several handoffs in one gap share one line, labeled with the member who holds the room by that turn and a count of the earlier ones ("剪刀手五号 接手 +1"); the tooltip lists the chain. Separate lines 10px apart stacked their labels into an unreadable overlap.
- **External agents' own sessions are log-driven.** A CLI member (claude-local, codex-local, kimi-cli, dsh-cli — any subagent provider but the in-process `spawn`/`fork`) runs in its own process, so none of its requests pass through this host; its session opened on its own shows only what its log holds. Once the log's `subagent/descriptor` (or the live one) names such a provider, the store marks the session log-driven (`markLogDriven`): live events no longer open turns, they only mark the log for a re-read (`noteLogActivity` → `needsLogRead`); each read rebuilds the loaded turns the log has grown or closed since and adds new ones, even after the backfill completed. The log's unclosed last turn reads as running, not interrupted. The panel stays pull-based: a read (opening, switching or stepping turns) shows what the log holds at that moment.
- **Unknown cache hit.** A request whose usage has no `cacheReadTokens` shows its hit rate as "—" and its map bar grey, instead of 0 % red. Some producers (codex, claude-code) do not report cache reads yet.

## Alternatives considered

**Showing member runs only inside the main turn that set up the room.** The runs happen hours later and would pile into one turn.

**Numbering rounds separately (R1, R2…).** Two sequences on one map read as two conversations; the user chose one sequence by time.

## Consequences

- 2026-10-25: the tab can inspect another session. Navigation params `{ sessionId, messageId, label }` point the panel at that session (a room member's child session), select the turn the message closed (`resolveTurnSeq`), and show a 「正在看：… 的会话」 strip with 回到本会话; the conversation is not scroll-synced while another session is shown.
- Turn numbers in the panel no longer equal the host's turn numbers in a room session; elsewhere they still match.
- Without `childTurn`, two runs of one member that overlap in time share requests. The room plugin is adding `childTurn` on `done`.
- Rounds are not windowed; a room with hundreds of dispatches lists them all.

## Testing

`tests/room-rounds.spec.ts` covers the hidden holder, rounds numbered with main turns, the handoff, slicing a run by span and by child turn, the trend rows, and skipping dispatches made inside a main turn.
