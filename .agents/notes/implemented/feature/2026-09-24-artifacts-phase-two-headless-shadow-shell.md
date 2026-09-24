# Agent Note: Artifacts face phase two — a headless kernel, turnTail shadowing, and the list shell (host 0.1.7-rc.1)

Status: implemented

> **REVERTED the same day (2026-09-24):** plan B and this phase-two cut were
> vetoed by the repo owner — the self-drawn products page (address-claim form)
> ships on both host lines again. Only the turnTail deliverables shadow
> survived the veto. This note is kept as history; the mechanism evidence
> (slot-shadowing semantics, the absent config switch) is still accurate.
> Current truth: [Plan B reverted](../architecture/2026-09-24-file-preview-plan-b-reverted.md).

## Problem

Plan B (2026-09-24, commit `2fdc81ad`) registered ui-file-preview's content pane
into the official document tab as its default renderer and retired the self-drawn
FilePreviewTab content page. Dogfooding on the rc.1 instance surfaced three
problems the first cut accepted:

1. **Triple chrome overlap.** The official document tab already draws a path row,
   the "open with" renderer picker, reload, and the native-open actions — and our
   embedded pane repeated the same rows (its own title/path bar, its own
   content-search row, its own preview/source switch). Two stacked toolbars read
   as one buggy surface.
2. **Two product tables per turn.** The official `DeliverablesTail` entry renders
   the model-curated present card (durable) plus the workspace-changes card
   (memory-resident, lost on a host restart); our TurnFileRow renders the durable,
   complete per-turn list right below. The user decided (2026-09-24): keep only
   ours. But the present card is also the open entry for binaries (images, Office)
   — suppressing it had to be proven not to break that chain, and the repo forbids
   DOM hiding/injection hacks (DOM anchors are a last resort with a mandatory
   fallback — not allowed here).
3. **The session-products entry was gone.** The retired page was the only place
   listing everything a session wrote. Its function needed to come back without
   resurrecting the self-drawn content view.

## Decision

Three moves, all rc.1-arm only; the 0.1.5 arm is untouched.

**A. The shared kernel grew an explicit `headless` mode** (opt-in prop, never
probed): `packages/ui-content-preview`'s ContentPane drops the chrome its host
frame already carries — the title/path bar and the view controls — and renders
the content area (plus the truncation notice and the slow-render hint). Two
affordances STAY because the rc.1 official document tab has no equivalent for
either: the content-search row (verified: no search input anywhere in
ui-sidebar-documentpreview's rc.1 source or shipped bundle — keeping it is a
unique contribution, not a de-duplication target; the first cut of headless
dropped it and was corrected by the repo owner the same day) and the floating
copy-path button at the content's top-right corner (the official
`sidebar.right.tab.document.actions` contributions — ui-open-in-app's
OpenPathAction — carry native opens only, and the official TextPreview header
has no copy affordance). Only ui-file-preview's FileContentBody (the official
document tab's default renderer) uses it; local-files and worktrees have no
host frame to borrow and keep the full chrome.

**B. The official deliverables cards are shadowed, not removed.** The mechanism
evaluation went in the task's order:

1. *Config switch* — none exists. `tool-present`'s Config is only `maxFiles`
  (`packages/deliverables/tool-present/src/index.ts:15-23` in the harness);
  `workspace-changes`'s Config is bounds only
  (`packages/deliverables/workspace-changes/src/index.ts:33-51`); the
  ui-deliverables client exports no Config at all — its only gate is the
  user-facing `configForms.developerTools.enabled` preference gating the changes
  card (`packages/client/ui-deliverables/src/client/Deliverables.tsx:70,79`),
  unrelated semantics and not ours to flip.
2. *Slot shadowing* — first-class and documented. `conversation.chat.turnTail`
  is a list slot (`packages/client/ui-chat/src/client/contract/slots.ts:265`).
  The slot core sorts same-cell entries by ascending priority and renders the
  lowest live one: `packages/client/ui-slots/src/index.ts:778` (KindOptions list
  docs: "lowest renders; same id + same priority throws"), `:1229-1235`
  (register() throws the shadow hint), `:1352-1368` (`entriesOfSlot` projects
  each cell to its winner), and the list outlet consumes exactly that projection
  (`packages/client/ui-renderer/src/client/scoped-slots.tsx:1220`). Shadowing
  exists since 0.1.0-rc.8 (`0367506471`), so every host whose turnTail is
  list-kind (0.1.6-alpha.2+) has it.

  So the list arm registers a second entry under the official card's cell id
  `@deepseek-ai/dsh-client-ui-deliverables` at `priority: -1` whose component
  renders null. The official registration stays on the ledger — its declared
  `deliverables.file.actions` child slot never collapses, so ui-open-in-app's
  contributions to it keep registering cleanly; the mention-open wrap
  (`chatFileMentions`) is a provided service and unaffected. No DOM is touched;
  disposing our fiber restores the official card exactly.

  The binary-open chain was verified before landing: both the present card
  (Deliverables.tsx:111) and our TurnFileRow (TurnFileRow.tsx) open through the
  SAME owner `openFile`, which ui-chat implements as
  `sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))`
  (`packages/client/ui-chat/src/client/apply.ts:184`). The official text tab type
  claims every session file address at the fallback band; renderer selection is
  suffix-matched, and our content renderer claims only the text set plus avif —
  images (png/jpg/…) resolve to the official image renderer, Office to the
  official office/excel renderers, unknown binaries to the official unpreviewable
  state with native-open actions. Nothing on that chain passes through the
  suppressed card.

**C. The session-products entry returned as a thin list shell.** A new page-type
right-sidebar tab kind `file-artifacts` (guide entry 「会话产物」, same glyph and
title as the retired page) lists the session's written/edited files off the
existing host fold (`filePreview.list` — no new Remote), with the name filter
and refresh carried over. A row click routes the canonical
`dsh-resource://file/session/<id>/<path>` address through
`sidebarRight.openResource` — the official document tab renders it (our content
renderer is the default body; the change history is one dropdown away). The
shell claims no address (no `patterns`) and draws no content. It registers from
the same `inject: ['documentPreviews']` nested fiber as the renderers, so it
exists exactly on the rc.1 line.

## Alternatives considered

- **Suppress the cards by CSS / DOM removal** — forbidden outright: the repo
  rules allow DOM anchors only as a last resort with a fallback, and the task
  explicitly barred the path for this task. It would also desynchronize on every
  host render change.
- **Wrap or monkey-patch the official entry's component** — the slot system has
  no such hook; the wrap would have to target the DeliverablesTail function
  identity across package boundaries, which is exactly the fragile coupling the
  slot mechanism exists to avoid.
- **Keep coexistence (the 2026-09-18 decision)** — already tried; the user saw
  two stacked tables per turn and decided for convergence (2026-09-24).
- **Register the shell as a claimant of `dsh-resource://file/**`** (the 0.1.5
  page's shape) — that would re-split "one file, one tab": the official document
  tab already claims every file address on rc.1 and hosts both our renderers. A
  page type with no claims keeps routing single-homed.
- **Suppress the content-search row too (uniform headless)** — the first cut
  did exactly this, on the theory that a host frame owns all chrome. The rc.1
  official document tab has no content search at all (verified in source and
  bundle), so suppressing the row is not de-duplication but a silent feature
  removal; the repo owner corrected it the same day. The rule that survived:
  headless drops only what the frame actually carries.
- **Carry the HTML scripted tier's arming toggle into headless** — rejected:
  the toggle is chrome by shape (a view switch), and the official HTML renderer
  in the same dropdown already covers scripted documents.

## Consequences

- The document tab shows one toolbar (the official one) with our content body
  under it; the turn area shows one products card (ours, durable and complete).
- The shadow is one-directional and reversible: uninstalling or disabling this
  plugin restores the official cards, and a composition without ui-deliverables
  just gains a harmless empty entry in its cell.
- Given up on the rc.1 line, deliberately: only the pane's HTML scripted tier
  inside the document tab (its arming toggle was chrome; the official HTML
  renderer remains one dropdown switch away). Content search stays — see
  Decision A.
- The turnTail shadow pins the official entry id as data. If upstream renames
  the entry id, the shadow degrades to a no-op (the cards return) — fail-open,
  caught by the browser-plugin spec that asserts the winner's priority.
- 0.1.5 is byte-identical in behavior: the chain branch never registers the
  shadow (chain slots have no shadowing), and the shell never registers without
  `documentPreviews`.

## Testing

- `ui-content-preview` — content-pane spec gained a headless describe: chrome
  absence (title bar, view controls), the search row's presence and working
  highlighting, the floating copy affordance (present/clicked/absent), pinned
  content view against a diff supply, and the truncation notice.
- `ui-file-preview` — browser-plugin spec asserts the ledger shape (official
  entry + shadow + our row coexist), the shadowed winner through
  `entriesOfSlot`, the shadow rendering null, the artifacts type/body
  registration on rc.1 only, late-arrival retirement, and full disposal;
  FileArtifactsTab spec pins list rendering (products only, latest-first),
  row-click routing, filter, refresh, and the empty/error states.
- `file-preview` (host half) untouched and green.
