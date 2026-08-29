# Agent Note: local-files workspace preview remembers the last browsed file position

Status: implemented

English | [中文](2026-08-29-local-files-scroll-memory.zh.md)

This note records the decision to make the local-files 工作区 preview restore the position (scroll offset) the user last browsed, instead of jumping back to the top when switching tab away and back.

## Problem

The local-files workspace tab is a `conversation.view` entry, and the host renders only the active view (`renderSlot('conversation.view', props, { only: active.id })` in the host's `ConversationSession`). Switching to another tab (chat / 产物 / worktrees) unmounts `WorkspaceView` (and its `DetailPane`), and the content `scrollTop` — plain DOM state — is lost with it. Reading a file partway down, switching tabs, and returning placed the pane back at the top even though content and selection survived: they live in the per-session view store, which the slot framework keeps alive across scope (`storeOf(entry, scopeKey)`).

So the two facts to reconcile: content/selection persist, but scroll (DOM state) does not.

## Decision

Track the selected file's content-pane scroll offset in a module-level `Map` keyed by `<sessionId> \0 <absolute path>`, and restore it on mount / content-load. Implementation in `packages/local-files/src/client/DetailPane.tsx`:

- A `useRef<HTMLDivElement>(null)` (`scrollRef`) on the scrollable containers (`.previewScroll` for text/structured/html-source, `.imageScroll` for images).
- An `onScroll` handler that writes `scrollRef.current.scrollTop` into the Map — a plain Map write, so scrolling never re-renders the file tree.
- A restore `useEffect` keyed on `[memKey, read]` that sets `scrollRef.current.scrollTop` from the Map when a saved offset exists.

A module Map (not a store field) was chosen because a store field would re-render `WorkspaceView` → `FileTree` on every scroll event; a module Map is write-only per scroll and survives the view unmount without any subscription. `WorkspaceView` passes its current `sessionId` into `DetailPane` so the key is session-scoped.

The HTML *render* mode (sandboxed `srcDoc` iframe) scrolls its own document, which the parent cannot read or set (unique origin); that path is intentionally not restored. Code/markdown/JSON/CSV/text/structured and image previews restore.

## Alternatives considered

- **Store field (`scrollTop` in the local-files store).** Checked and rejected: for correctness it needs the store to survive the unmount (it does), but a state write fires `useStore(s => s.scrollTop)` subscribers on every scroll frame, re-rendering the whole view including the lazy file tree. A module Map avoids that.
- **Capture on unmount (effect cleanup).** Rejected: React detaches refs during the mutation commit, so a passive-effect cleanup (which runs after mutation) can no longer read `scrollRef.current`. Capturing per-scroll-event is simpler and lossless (the last scroll event already recorded the offset before the unmount).
- **Per-session single offset (one slot, not keyed by path).** Rejected: keying by path gives per-file memory (select a different file and back still restores), which is what the user asked for — remember where you were in a file.

## Consequences

- No host changes; the plugin stays self-contained and independently installable (`@khorsheed/dsh-local-files`). `pnpm check:plugins` / `check:hygiene` expectations unchanged.
- The scroll cache is per page-session (module cache); it resets on plugin reload. Bounded by the paths browsed in a page session.
- Only the reported local-files surface changed. The worktrees **仓库文件档** content pane has the same unmount-on-tab-switch shape and is a possible follow-up, out of scope here.
