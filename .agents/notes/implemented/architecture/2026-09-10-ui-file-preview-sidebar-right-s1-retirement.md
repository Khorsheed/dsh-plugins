# Agent Note: ui-file-preview moves to the 0.1.5 right sidebar — S1 seam retired

Status: implemented

English | [中文](2026-09-10-ui-file-preview-sidebar-right-s1-retirement.zh.md)

## Problem

Host 0.1.5-rc.1 landed the right-Sidebar resource routing (seam registry S1): every file-open gesture (deliverables row, prose mention, tool-result line) converges on `ctx.sidebarRight.openResource()`, and `ctx.sidebarRightTabs.register()` lets third parties register tab types — page types enter from the guide page and claim no address; address types claim `dsh-resource://` globs. ui-file-preview's four workarounds (the `conversation.view` tab, the `shell.overlay` drawer, the mention capture-phase DOM interception, the turnTail `priority: -1` preemption) existed only because that seam was missing, and the DOM interception was the most fragile code in the package. The migration is batch two of `proposals/active/2026-09-10-host-015-adaptation.md`.

## Decision

- **New**: a page-type right-Sidebar tab (`kind: 'file-preview'`, id = package name, guide entry, no address claims — the ui-sidebar-files shape). Its body is the session's touched-file list (latest-first, searchable) over the selected file's change history. In-workspace row clicks both select locally and hand content preview to the official document tab via the tab's `actions.openResource(fileAddressFor(sessionId, cwd, path))` (`dsh-resource://file/session/<id>/<path>`). The turn card opens the page with `openTab('file-preview', { params: { path } })` for outside-workspace paths; the body applies the carried selection from `navigation.params` on every navigation revision.
- **Deleted**: `conversation.view` registration, the `shell.overlay` drawer, `mention-intercept.ts`, the turnTail `priority: -1`, the panel controller (`panel-service.ts`), host-description probing, and the whole self-drawn content-preview stack (FilePreviewPane's content half, `structured.tsx`, `html-bridge.ts`, `html-src-doc.ts`, copy/reveal/IDE gestures) — content rendering is the official `text` tab type's job.
- **Kept**: the turnTail mutation card (its host data includes bash captures — S2 still绕行中 — so it covers turns the official deliverables row declines). It now registers at default priority: the official entry (same band, registered earlier at host boot) elects first, and the card's unconditional claim is consulted only for turns official data misses. Card clicks route through the owner's `openFile` for in-workspace paths — the official openResource route — and through `openTab` for outside-workspace ones.
- **Boundary**: outside-workspace bash artifacts cannot be named by a `dsh-resource://file/...` address (the official `file` resource is workspace-scoped; the host answers `workspace-file/outside-workspace`). Their rows only select — the diff history is this plugin's own data and renders regardless — with an inline notice; no self-drawn preview is offered.
- **The change-history view (per-write diff stepping) stays self-drawn deliberately**: the official document tab has no history concept. `DiffHistory.tsx` is the extracted stepper; the list fetch alone (`filePreview.list`) carries the diffs, so the body never calls `read`.
- **minHost moves to 0.1.5-rc.1** (the extension surfaces it consumes did not exist before), version 0.3.0; older hosts stay on the 0.2.x line.
- **Dependency mechanics**: the package rides the repo-wide 0.1.5-rc.1 baseline. One repo-level adjustment was forced: the 0.1.5 client packages peer on `@deepseek-ai/cordis ^4.0.2` while the repo line is 4.0.1 — two cordis instances split every `declare module` merge (Context, SlotMap, LocaleNamespaceMap) into per-peer-variant copies, and a plugin's own merges then never reach the copy its imports resolve. `pnpm-workspace.yaml` gained `peerDependencyRules.allowedVersions: { '@deepseek-ai/cordis': '4.0.1' }` so the graph keeps one cordis instance. Separately, the 0.1.5 `dsh-client-store` npm artifact ships unbundled (bare `zustand`/`immer` imports, no declared deps — the official build bundles them; arguably an upstream packaging bug), and the client bundle inlines that engine (`INLINE_SAFE`), so the package dev-depends on `zustand ~4.4.7` + `immer ^10.1.1` to make the inline resolvable.

## Alternatives considered

- **Keep the drawer/view next to the right-Sidebar tab** — rejected: two previews of the same file in two places doubles the maintenance surface the migration exists to delete, and the drawer's only unique content (diff history) moved into the tab body.
- **Claim `dsh-resource://file/**` ourselves at `priority: 'extension'` and render content too** — rejected: the extension band would shadow the official `text` type for every client (a global takeover, not a local preference), and re-draws markdown/code/image/pdf/html renderers the host already ships. The tab type claims nothing; routing stays official.
- **Drop the turn card because official deliverables exists** — rejected for now: official data misses bash writes entirely (S2), so the card is the only per-turn surface for exactly those turns. Re-evaluate once the host's `present` tool普及s or S2 lands.
- **Self-declare the `sidebar.right.pane.tab` SlotMap entry instead of fixing cordis duplication** — rejected: it typechecks but silently forkbes the seat contract (a host-side change to the seat would compile cleanly against the stale copy). One cordis instance is the honest fix; the peer relaxation mirrors what the repo already ran as unmet-peer warnings.

## Consequences

- `pnpm --filter @khorsheed/dsh-client-ui-file-preview build|test` green (46 tests) against `DSH_HARNESS=deepseek-harness-0.1.5-alpha` (pinned `dsh-v0.1.5-rc.1`); the repo-wide build/test and the 3080 acceptance gate belong to the mainline baseline wave.
- The package sheds its most host-structural coupling (DOM interception, chain preemption); what remains is registry + slot + Remote surface only.
- Given up: the self-drawn document previews (markdown/JSON/CSV/HTML sandbox render), the external-open gestures (open-in-folder / open-in-IDE / copy-path), and content search. External-open is slated to return through the official open-in-app route in batch three (local-files A 方案 channel).
- The `peerDependencyRules` cordis relaxation and the `zustand`/`immer` devDeps are interim packaging seams: the former retires if the repo line moves to cordis ^4.0.2; the latter if the official `dsh-client-store` artifact bundles its runtime deps again. Other client packages inlining `dsh-client-store` need the same zustand/immer resolution — flagged to mainline.
- Seam registry: S1 marked 已退役 (0.1.5-rc.1); S2 unchanged (the host half's bash collector stays).
