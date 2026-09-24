# Agent Note: The shared content pane's reload-current-file gesture (caller-injected `onReload`)

Status: implemented

## Problem

Every community file surface shows a file's content as of the moment it was selected. When the file changes on disk — the agent edits it, the user saves in an editor, a git operation rewrites it — the panel stays stale until the user re-selects the file, and there was no gesture to say "read it again" (the repo owner's ask, 2026-09-24: a refresh icon and capability in the file render area of the local-files / worktrees right pane).

The constraint that shapes the answer is the pane's own boundary: the shared content pane (`@khorsheed/dsh-client-ui-content-preview`) owns no IO — the `read` arrives as a prop and each consumer's Remote knows how to produce it. A reload gesture therefore cannot live inside the kernel as a fetch; only the chrome (button, pending feedback, copy) can be shared.

## Decision

`ContentPane` grows one optional prop, `onReload?: () => Promise<void>` (`packages/ui-content-preview/src/client/contract.ts`). When supplied, the title action row renders a refresh button FIRST (ahead of copy-path), using the official `IconRefreshOutlineMedium`. While the returned promise is pending the button is disabled and its icon spins (the dsh-reader `.toolSpinning` precedent: a scoped `pane-spin` keyframe with a `prefers-reduced-motion` fallback). The pending state is the pane's own — the caller's promise settling is the only "done" signal that exists. The label prints through the caller-injected `t` as the new key `action.reload` (zh 重新加载 / en Reload in each consumer dictionary; `PREVIEW_KEYS` coverage specs make a missing entry a test failure in all three namespaces). A caller that does not pass `onReload` renders exactly what it rendered before.

All three consumers wire it to their own read path, keeping the old content visible while the re-read is in flight (a reload never clears the read first — unlike a fresh selection):

- `local-files` WorkspaceView: re-calls `readFile` for the selected path; on success `setPreview` (which also clears the error slot), on failure `setError` — the package's existing channel for failed reads. An answer landing after the selection moved is dropped via a selection ref.
- `worktrees` WorktreesTab: the selection effect's fetch logic is extracted into a shared `fetchDetail(dropped)` used by both the effect and the gesture, so reload re-fetches the ACTIVE view (diff through `fetchFileDiff`, content/image through the read Remotes) with identical branching. Success arms additionally clear a stale error; a stale-answer guard keys on path/segment/view/commit. `CommitDetails` deliberately does NOT pass `onReload`: a file pinned at a commit is immutable, so the gesture would re-read a value that cannot change.
- `ui-file-preview` FilePreviewTab DetailView: re-calls its `readFile(sessionId, path)` and updates the local read state; the change-history side (fold diffs) is out of scope — its data is the list, refreshed by the list page's own refresh button.

## Alternatives considered

**Watch the file system and push invalidations.** Rejected: no host watch capability exists for arbitrary local paths, the gesture alone covers the reported pain (the user knows when they just saved), and a push channel would be an upstream seam — not something three client plugins can invent locally.

**Reuse the surfaces' existing refresh (local-files `rev` / worktrees `refresh()`).** Rejected: those re-read the LISTING and summary planes — a wider, costlier fetch set than "this file", and in worktrees the detail effect deliberately does not key off `rev`. The gesture is scoped to the current file's current view.

**A `reloading` prop owned by the consumer.** Rejected: every consumer would re-implement the same pending bookkeeping; the caller's returned promise already carries the settle signal, so the pane owns the feedback state and the contract stays one callback.

## Consequences

Bought: one gesture, one implementation of the chrome and feedback, three surfaces healed at once — and the next pane consumer gets the button by supplying one callback. The no-IO boundary held: the kernel still knows nothing about Remotes.

Cost: `onReload` joins the prop set and `action.reload` the printed-key set (both mechanically pinned by the consumer dictionary specs). The reload's failure presentation inherits each package's existing error channel, which in local-files is a slot shared with the listing — a failed file re-read also marks the tree column; that is the package's pre-existing convention for any failed read, not a new compromise introduced here.

## Testing

`content-pane.client.spec.tsx` pins the contract: the button renders ahead of copy-path only when `onReload` is supplied, clicking calls it, and the button stays disabled (and click-guarded) until the promise settles. Each consumer's tab spec asserts the re-read against a mock Remote answering new content on the second call — local-files and worktrees additionally pin the failure path (old read kept, error channel used) and recovery on the next reload. Dictionary coverage of `action.reload` in zh/en is asserted by the existing `PREVIEW_KEYS` specs in all three consuming packages.
