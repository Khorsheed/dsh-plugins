# Agent Note: Plan B reverted — ui-file-preview keeps the self-drawn products page on both host lines

Status: implemented

## Problem

Plan B (shipped 2026-09-24 as `2fdc81ad`, recorded in [the official-document-pane
note](2026-09-24-file-preview-official-document-pane.md)) moved ui-file-preview's
content face into the official document tab on rc.1: the shared content pane
registered into `ctx.documentPreviews` at the extension band as the tab's default
renderer, and the self-drawn FilePreviewTab page type was retired on that line.
Phase two (`ada7ac89` / `2dee4958`, recorded in [the phase-two
note](../feature/2026-09-24-artifacts-phase-two-headless-shadow-shell.md)) then
embedded the pane headless to de-overlap the frame chrome, shadowed the official
deliverables turn card, and re-added the session-products entry as a thin
file-artifacts list shell. Dogfooding the assembled result on the rc.1 instance,
the repo owner vetoed the whole embedding the same day:

- The seam cost is real and permanent: the renderer-owned loading protocol
  (`loading: 'renderer'` + revision/`loaded(version)`/`failed()` settlement), the
  extension-band default-takeover semantics, and the headless layout coupling all
  bind our pane to the official frame's internals — each upstream move of that
  frame becomes our breakage.
- The UX compromises were losses, not trades: the change history (this package's
  reason to exist) was demoted to the document tab's renderer dropdown, and the
  copy-path gesture degenerated to a floating button over the search row.
- The self-drawn page's routing never needed the official frame: the tab-type
  address claim (`patterns: dsh-resource://file/**` + a static suffix filter at
  the extension band) outranks the official `text` type's fallback band on BOTH
  host lines — rc.1's tab registry kept the band mechanism — so file clicks land
  in our full-chrome page with zero embedding seams.

## Decision

Plan B and phase two are reverted wholesale; one form ships on both host lines:

- The `file-preview` page type registers UNCONDITIONALLY (no `documentPreviews`
  probe, no deferred retirement fiber): guide entry plus the extension-band
  `dsh-resource://file/**` renderable-suffix claim, body in the keyed
  `sidebar.right.pane.tab` seat. File tree, mentions (via the wrap), the turn
  card, and the deliverables row all route to the detail view; declined suffixes
  (pdf, archives, binaries) fall through to the official document tab.
- Deleted: `FileContentBody.tsx`, `FileHistoryBody.tsx`, `FileArtifactsTab.tsx`,
  `content-definition.ts`, `artifacts-definition.ts` and their specs;
  `history-definition.ts` folds its surviving claim filter
  (`RENDERABLE_EXTENSIONS`/`renderablePath`) into `definition.tsx`. The
  change-history dropdown renderer in the official tab (a pre-plan-B seam) goes
  with the veto — the change history lives only in the page's detail view again.
  The `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` /
  `dsh-client-resources` / `dsh-api-workspace-files` faces leave the manifest.
- The shared kernel's `headless` mode is retired entirely (prop, render
  branches, `rootHeadless`/`copyFloat` CSS, the spec block) — its only consumer
  was the vetoed embedding; local-files and worktrees never used it.
- NOT reverted: the turnTail deliverables shadow (the present/changes cards
  still lose to our durable complete row on list-kind hosts — the veto named
  only the embedding) and the FilePreviewTab `navigation.params.path` `'path' in`
  narrowing fix (a genuine pre-existing bug fix).
- minHost stays `0.1.5-rc.1`: the package carries no rc.1-only API after the
  revert (the turnTail list/chain arms already had the 0.1.5 fallback).

## Alternatives considered

- **Keep plan B and keep patching the seams** (the phase-two trajectory) — the
  veto's point is that the seam count is structural, not incremental: every
  de-overlap fix binds tighter to the frame's internals (headless layout, the
  loading protocol), and the change-history dropdown demotion has no fix at all.
- **Keep the file-artifacts shell alongside the restored page** — redundant: the
  restored page IS the session-products list with the detail view behind it; a
  second list-only entry would duplicate it for no routing benefit.
- **Keep the history renderer in the official dropdown** — it was the entering
  wedge of the demotion the veto named, and its registration is another
  documentPreviews seam; the detail view's Content / 改动记录 toggle carries the
  dimension with better chrome.
- **Delete the reverted notes** — kept as history instead, with a banner on each
  pointing here; the mechanism evidence they record (slot shadowing semantics,
  the missing config switch) remains true and reusable.

## Consequences

- One surface form on both host lines again: no dual-line probe, no nested
  retirement fiber, no rc.1-only code in the package.
- The official document tab sees only the suffixes we decline; everything else
  renders in our page with the full chrome (title bar, view controls, content
  search, copy/folder/IDE gestures).
- The turnTail shadow survives on the same evidence it was chosen for; a host
  whose turnTail is chain-kind (0.1.5) keeps the preemptive chain arm.
- The kernel is back to exactly one chrome mode — the `headless` prop no longer
  exists anywhere, so no consumer can drift into it.
- Tracked upstream unchanged: the change-record dimension has no official
  counterpart (workspace-changes is memory-resident, git-only, lost on restart);
  if the official side ships a durable equivalent, retirement is re-evaluated.

## Testing

- `ui-file-preview`'s browser-plugin spec returns to the single-form bench: the
  tab type's claim semantics, the body's registration, the turn row plus the
  deliverables shadow (ledger coexistence, the `entriesOfSlot` winner, the empty
  body), the chain fallback, and full disposal; the rc.1-arm spec files leave
  with their subjects.
- `ui-content-preview`'s headless describe block is deleted with the mode; the
  pre-existing 52-test suite passes untouched.
- Repo gates: `pnpm run build`, `pnpm run test`, `check:plugins`,
  `test:scripts`, `check:hygiene --all` all green on the reverted tree.
