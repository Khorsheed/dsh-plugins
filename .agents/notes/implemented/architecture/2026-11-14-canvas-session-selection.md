# Agent Note: canvas selection is scoped by session

Status: implemented

## Problem

The canvas client created one `CanvasSelectionStore` for the whole browser application and persisted it under the single `dsh-canvas.tabs` key. Switching conversations therefore opened the same canvas tabs, card and manuscript, even though the host keeps independent session subtrees. Ordinary canvases could also be left without a durable binding, so a fresh session had no reliable work to restore.

## Decision

- The apply closure lazily owns one `CanvasSelectionStore` per session id. The tab body, dock title, navigation destinations, inbox, quote actions and binding chip write to the store for their own session. Root-level composition without a session keeps the unscoped key.
- Each scoped store persists under `dsh-canvas.tabs:<sessionId>`. A pre-existing unscoped strip migrates to the first scoped reader and is removed from the old key; it is not copied into every conversation. Unsaved editor text remains in the host's independent session subtree and is not persisted, as before.
- Board mutations and write notifications fan out freshness to every store, because canvases themselves remain shared deployment data. Selection, deletion cleanup and navigation stay scoped.
- A newly mounted session with no restored rows reads its durable binding and opens that work first. Without a live binding it retains the recent-activity fallback. Merely viewing another canvas does not silently rebind the session.
- Room and other global entry points resolve the currently displayed coordinator session explicitly. There is no inferred per-session ownership filter on the shared canvas library.

## Alternatives considered

- **Put every session's state in one store.** Rejected: the host already supplies independent session subtrees and per-session slot injection, so separate small stores preserve the existing component API and keep draft state naturally isolated with much less churn.
- **Share tabs intentionally across all sessions.** Rejected: the right Sidebar is session-bound; collaboration needs explicit destinations into a coordinator's view, not every conversation silently controlling the others.
- **Filter the canvas library to works owned by the session.** Rejected: canvases carry no reliable owner and multiple sessions can collaborate on one work. Scope belongs to the view and target, not data visibility.
- **Leave the old shared key in place as a fallback for everyone.** Rejected: that would reproduce the original leak on every fresh session. It migrates once instead.

## Consequences

- Existing canvases, bindings and collaboration data need no migration. Only browser-local tab state changes shape.
- The canvas package build and all 37 test files pass, now including independent scoped restoration, one-time legacy migration and bound-work-first opening.
