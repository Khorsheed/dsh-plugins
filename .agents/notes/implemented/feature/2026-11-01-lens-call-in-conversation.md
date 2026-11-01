# Agent Note: Context Lens shows a tool call where it happened

Status: implemented

## Problem

A request's history in Context Lens lists tool calls and their results, but a reader often needs the scene around a call: what the conversation looked like when it ran. For example, eight identical `Replaced 1 occurrence in …` results came from eight different edits, and only the conversation shows which edit each one was. The lens could jump within its own panel, but it could not take the reader to the call in the conversation on the left. In a room, an external member's calls are not in the room conversation at all. They live in the member's own session.

## Decision

- **A call row offers 在会话中查看 when its calls are in this conversation**: the main agent's, and those of children it delegated by a tool call (they nest under that call). The jump finds the host's `data-chat-call-id` row (ui-tool ToolCallTree). A call not rendered yet pages history back to its turn through `loadThrough`, and a call the jump cannot find falls back to its turn.
- **Folded step groups open one layer at a time.** The host keeps their rows in the DOM under `hidden="until-found"` and opens them on `beforematch` (ui-chat searchable-hidden). Opening is a React re-render, so the jump sends the scrollport one `beforematch`, then each frame re-finds the row and opens its outermost fold that is still closed. When the row renders, or after about 60 frames, it lands. This is the host's own reveal pattern (session-inspector `chat-node/reveal.ts`), without its `flushSync`.
- **A room member's call offers 在成员会话中查看.** It applies to a member run of a room round, keyed by the child session id. The room's lens panel cannot finish this jump itself: the right Sidebar is kept per session, so switching sessions unmounts the panel. The hand-over runs at the plugin level instead (`client/member-jump.ts`). It opens the member session with `uiWorkspace.openSession`, the entry the room's 轨迹→ uses. It waits until that session is on screen and the lens kind accepts a tab there, giving up after 5 s. Then it opens the lens tab with the `locateCall: { callId, hostTurn? }` navigation. The member session's lens selects the call's turn and runs the same jump.
- **The room's panel keeps its place.** Before handing over, it stores its selection (viewed session, turn, scope, request, main tab) in a module-level map keyed by its session, and takes it back once on remount. A newer navigation (a higher revision) wins over the stored place.
- **Everything degrades silently.** Without `uiWorkspace.openSession` the member button is not offered. A throwing open stays put, and a session that never comes up ends the wait.

## Alternatives considered

- **Do the member jump inside the room's panel.** Rejected: the panel unmounts as soon as the session switches.
- **A host channel for "open session at anchor".** Rejected: not needed. The public open, the session binding's `loadThrough` and the DOM conventions were verified to be enough, on a disposable instance against the real room session.
- **Fire `beforematch` on every fold at once.** Rejected: an inner fold can be replaced by the outer one's re-render before it opens.

## Consequences

- If the member's call is older than the member lens's loaded turn window, the jump has no turn `startSeq` to page to. It then lands on the turn, or does nothing until that window is loaded.
- The browser's back button does not return to the room, because session switches add no history entry. The room's breadcrumb and the member session's 回到房间 do.
- Jumping by turn inside a member session was seen landing about 3,800 px off on the disposable instance. That is a separate issue: jumping by call id does not use the turn path.
