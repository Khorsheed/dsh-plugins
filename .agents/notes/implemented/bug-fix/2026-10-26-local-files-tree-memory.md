# Agent Note: The local-files tree keeps its view across tab and page switches

Status: implemented

## Problem

Switching the right sidebar to another tab, or the app to another page, and coming back found the 文件列表 tree fully collapsed and scrolled to the top. The selected file survived, because it lives in the slot store the host keeps. The tree's expansion, its loaded children and its scroll offset were component state, and the host unmounts a tab's body whenever something else takes over. Measured on a real instance: three expanded folders and a 66px scroll became zero folders and the top, after either switch.

## Decision

`FileTree` takes an optional `memoryKey`. Under it, a module-level map keeps the expanded set, the lazily loaded children (keyed by directory path) and the scroll offset. A remount paints the remembered tree on its first frame. The offset is restored before paint on the nearest vertically scrolling ancestor, since the tree scrolls inside the split layout's column, not itself. The open folders are then re-listed in the background, so changes made while the tab was away show up. `WorkspaceView` passes `(session id, current root)` as both `key` and `memoryKey`: a different root or session remounts onto its own memory, and remembered relative paths never leak across roots.

## Alternatives considered

**Move the view state into the slot store.** The store survives the unmount, but the expansion set and the children cache are view-local and change on every click. Putting them in the store pushes per-click churn through every subscriber of a store whose other fields drive the preview. It also needs a reset rule for root and session changes that the remount-by-key gives for free. The module map matches the content pane's scroll memory, the established pattern for "outlives the component, not the page".

**Persist to localStorage.** That would survive a reload too, but a reload is a fresh look. Remembered children would be stale across reloads, and a per-path expansion map for every directory ever browsed would grow without bound in storage.

## Consequences

- Coming back to the tab looks exactly as you left it, and the children re-listing keeps it current.
- The memory lasts for the page's lifetime only; a reload starts collapsed, as before.
- Search mode keeps its own seeded expansion and is not remembered.
- The worktrees panel had the same loss in all three modes (measured: both trees collapsed and scrolled to the top; the commit list scrolled to the top). It now follows the same decision through `packages/worktrees/src/client/scroll-memory.ts`: `expansionMemory` and `useScrollMemory`, keyed by `(session, worktree, mode)`, so each mode and each worktree keeps its own view. Its trees are not lazy, so there are no children to remember or re-list. The commit list scrolls its own `.rows` element rather than its column, so the hook takes the element itself when it scrolls and otherwise its nearest scrolling ancestor. `forgetViewMemory()` resets the memory between test cases, because the memory outliving a mount is the point and would otherwise leak across tests.
