# Agent Note: ui-file-preview content face moves into the official document pane (plan B)

Status: implemented

## Problem

Host 0.1.7-rc.1 grew the official document tab into a real extension point:
`ctx.documentPreviews.register` admits external renderer implementations
(extension band outranks the official builtins, the toolbar dropdown keeps
every match), the owner supplies paged/bytes/renderer-owned loading, and
ui-open-in-app already contributes the native folder/IDE gestures to the
document toolbar. ui-file-preview's self-drawn FilePreviewTab — a page-type
right-Sidebar tab claiming `dsh-resource://file/**` at the same extension
band — now duplicates a frame the official side owns, while its change-record
dimension (per-turn products card, per-write diff history) still has no
official counterpart (workspace-changes is memory-resident, git-only, and
lost on a host restart). The user picked plan B (2026-09-24): switch the
content preview face to a registration in the official pane on rc.1, keep the
self-drawn pane on 0.1.5 (npm's latest release line), keep the change-record
dimension ours, and track upstream for an equivalent.

## Decision

One plugin, two content faces, chosen by capability probe in
`installFilePreviewSurfaces` (`packages/ui-file-preview/src/client/index.ts`):

1. **The probe never reads a version.** A point-in-time
   `ctx.get('documentPreviews')` skips the legacy registration when the pane
   already provides the service; a nested plugin pended on
   `inject: ['documentPreviews']` (`.../document-pane`) registers the rc.1
   renderers and calls `retireLegacySurfaces()` when the pane arrives later.
   cordis 4.0.4's service-access guard forbids an undeclared
   `ctx.documentPreviews` property read, and a static inject would pend the
   whole plugin on 0.1.5 — the deferred-inject pattern of
   [settings dual-line](2026-09-24-settings-config-forms-dual-line.md). The
   two content faces never coexist; an rc.1 composition with documentpreview
   mounted out degrades to exactly the 0.1.5 surfaces.
2. **rc.1: two renderers in the official document tab.** The content
   renderer (`content-definition.ts` + `FileContentBody.tsx`) registers at
   the default `extension` band — file clicks land in the official tab with
   the shared content pane as the DEFAULT body, official renderers one
   dropdown switch away. `loading: 'renderer'` keeps the read on the
   plugin's own Remote, so outside-workspace products keep rendering (the
   owner's workspace-scoped paged read cannot serve them); the body settles
   each owner revision through `loaded(version)`/`failed()`, taking the
   version token from the standard `useResource<'file'>` metadata so the
   owner's change detection and auto-refresh keep working. The history
   renderer is unchanged (`builtin` band, dropdown-only).
3. **0.1.5: unchanged.** The FilePreviewTab type and body register exactly
   as before; minHost stays `0.1.5-rc.1`.
4. **Gesture roster on rc.1** (each differentiator folded in or yielded):
   copy path / content search / structured rendering (JSON tree, CSV table,
   markdown) / tiered sandboxed HTML ride the pane into the registration;
   show-in-folder and open-in-IDE yield to ui-open-in-app's
   `sidebar.right.tab.document.actions` contributions; image preview yields
   to the official zoom viewer except avif (unclaimed officially — kept, and
   declared a `binaryExtensions` entry so no plain-text fallback offers
   itself); oversized files move from our truncation notice to the official
   text renderer's paged scrolling (a dropdown switch away). Kept untouched:
   TurnFileRow, FileHistoryBody, the host Remote, the mentions wrap.
5. **Dictionary cleanup.** The retired drawer's copy (drawer.* 8 keys,
   row.* 5 keys, turn.summary/summaryOne/expand/collapse) was already dead
   on both lines and is removed; `content.title` (「预览」/“Preview”) is the
   content renderer's dropdown label.

## Alternatives considered

- **Keep the self-drawn tab on rc.1 too (the pre-plan-B status quo).** Two
  frames claiming the same addresses; the official pane's rc.1 expansion
  (zoom, FortuneSheet, office-via-libreoffice, actions slots) makes the
  duplication visible, and the user judged the official coverage sufficient
  for the content dimension.
- **Register at the `builtin` band so the official renderer stays default.**
  Demotes the plugin's reason to exist (the enriched pane) to a dropdown
  entry and changes what every file click shows; the extension band is the
  registry's documented seat for external implementations and preserves
  today's default-ours behavior inside the official frame.
- **`loading: 'text-pages'` (owner-prepared content).** Official paging,
  versioning, and auto-refresh for free — but the owner's read is
  workspace-scoped, which kills outside-workspace rendering, a headline
  capability the user explicitly kept; renderer-owned loading keeps the read
  on our Remote.
- **Claim images too.** The pane's plain `<img>` arm is strictly worse than
  the official zoom viewer; only avif stays (the official image renderer
  does not claim it).
- **Static `inject: ['documentPreviews']` on the plugin row.** Pends the
  whole plugin forever on 0.1.5; the point-in-time get + deferred nested
  plugin is the sanctioned two-arm probe.

## Consequences

- File clicks, mentions, the deliverables card, and the turn card converge
  on ONE tab per file on rc.1 (the official document tab); the viewer
  dropdown offers 预览 (ours, default) / 改动记录 (ours) / official
  renderers — strictly more reachable than the 0.1.5 split, where the
  history renderer only served files our claim declined.
- Losses accepted and recorded: the guide-page 会话产物 list entry is gone
  on rc.1 (per-turn products survive in TurnFileRow); our folder/IDE
  buttons vanish in compositions without ui-open-in-app; the pane's
  content⇄diff toggle and fullscreen ride inside a frame that owns its own
  toolbar, so the pane renders its own title bar under the official one
  (visual duplication accepted for v1 — removing it needs a headless-body
  mode in the kernel package, out of this change's scope).
- Outside-workspace rendering survives the switch (renderer-owned loading);
  tabs for such files lack official change detection when the `file`
  resource has no metadata for them (manual reload).
- Tests pin both arms on one bench: rc.1 (renderers registered, legacy
  absent), 0.1.5 (legacy registered, renderers absent), late arrival
  (legacy retired on provide), plus a FileContentBody component spec for
  the renderer-mode lifecycle (`loaded`/`failed`/revision refetch).
- The pre-existing rc.1 type-plane error in FilePreviewTab
  (`navigation.params.path` against `WorkspaceFileParams`, which carries
  only `line`) is fixed with the official TextPreview's own `'path' in`
  narrowing.
