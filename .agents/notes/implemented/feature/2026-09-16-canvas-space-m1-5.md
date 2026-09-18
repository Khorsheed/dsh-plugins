# Agent Note: canvas M1.5 — the summary/detail split and the tab as a card-detail reader

Status: implemented

English | [中文](2026-09-16-canvas-space-m1-5.zh.md)

## Problem

M1 shipped the card board and was accepted onto 3080. The acceptance run surfaced one structural complaint: an imported long article **blew up its card** — the board rendered the full text verbatim (a document card starting from the raw `# 大模型心理学…` opener, unclamped, unrendered), so one card could fill the whole board. The board needs a summary/detail division of labour: summaries on the board, full text somewhere else. The proposal's §3 「摘要与详情分工」 and the M1.5 milestone answer it: clamp on the board, a detail reader in the right-Sidebar canvas tab — which also means the v1 pad editor's era in that seat ends (its storage and the M1 import channel were already its future).

Three sub-problems shaped the slice. **What is a summary?** A clamp (~6 lines + fade) needs a long-text detector that never measures layout, and a document card needs a title that is not the raw markdown opener. **How do two seats share "which card is open"?** The board panel (root scope) and the right-Sidebar tab (session scope) are separate slot registrations in one client bundle; the detail must follow board clicks and both seats' mutations. **How does a body click activate the tab programmatically?** And if no official API exists, the click must degrade to just the shared store.

## Decision

**Board cards are summaries, documents lead with a derived heading.** Every card clamps at ~6 lines (`-webkit-line-clamp`); `isLongCardText` (a pure textual estimate — characters or newline count, never layout measurement) drives the bottom fade and the word count. Document cards lead with `documentHeadingOf`: the first markdown heading, else the first non-empty line — never the raw `#` opener — and the summary body drops the heading line so it never shows twice. Both helpers are pure vocabulary in `types.ts`, tested like the rest of it.

**Click semantics split cleanly: body = detail, corner checkbox = selection.** A body click writes the shared store and activates the detail tab; multi-select moved to a hover-revealed checkbox in the card's top-right corner (always visible once selected), so the two gestures never fight. The lens bar logic is untouched.

**The shared store is the only cross-seat channel.** `space/selection.ts` holds `{ canvasId, cardId, rev }` in a `createSnapshotStore` (the repo's client-store primitive, the worktrees `OpenInAppProbe` pattern). One instance lives in the client `apply` closure and reaches both seats through their inject faces' `hooks.selection` compartment (the slot runtime materializes it into the `useSelection` prop). `select()` writes the open card; `touch()` bumps `rev` — and the apply-level face wrappers call it centrally on every landed mutation from EITHER seat, so the other seat re-reads. The mutating seat already has the fresh board from the response, so its own rev-triggered re-read is the one idempotent extra fetch this consistency costs — accepted deliberately over version-gating cleverness.

**Tab activation rides the official `ctx.sidebarRight.openTab('canvas')`** (the worktrees badge precedent), inside a try/catch: `openTab` requires a mounted session, so a composition without one (or without the right Sidebar) degrades to the store write alone — the tab renders the detail whenever it is open by any other means. File attachments open through `ctx.sidebarRight.openResource` over a `dsh-resource://file` address built by `fileAddressFor` (the official document preview; html files included). The **inline srcdoc html preview and an `assets/` read verb are deferred to M4** — no card can carry an `assets/*.html` pointer before M4's paste-html flow exists, so the verb would protect and the renderer would serve content that cannot exist yet.

**The tab is a card-detail reader, not the pad editor.** It follows the store: header (kind icon, ghost/archived flags, question state, created/updated times), the FULL text through `MarkdownText`, the comment thread (readable and postable), the ghost's ✓/✗ wired to `patchCard`, and the attachment area (url → link; file → `openResource`; paste → note). An **edit toggle** swaps the body for the extracted `CardTextarea` — the v1 three invariants, one implementation shared by board and detail (uncontrolled, IME composition as a hard stop, ⌘⏎/blur saves through `patchCard`, the seat's own single scroll container) — then returns to reading. The tab is session scope, so its mutations fence through the tab's own session. The v1 pad editor (`CanvasView.tsx`, its CSS, and the geometry spec) is deleted; the v1 five Remote verbs stay untouched on the wire, the pad's files stay on disk, and M1's import carries them forward.

## Alternatives considered

### Why not clamp with a measured (scrollHeight) detector instead of a textual estimate?

Measuring needs a per-card effect and a resize observer to stay honest, and it still guesses wrong during font load. The textual estimate (`>240` chars or `>6` newlines) is deterministic, testable without a DOM, and wrong only in the cheap direction (a short-but-clamped-looking card that simply shows the fade). The CSS clamp does the real cutting either way.

### Why not pass the open card through tab navigation params instead of a shared store?

`openTab(kind, { params })` carries params only at open time; the reader must also follow LATER board clicks without re-invoking openTab, and both seats' mutations must re-sync the other seat's data. Params are a one-shot envelope; the store is a live channel. (openTab is still called — for activation — but carries no params.)

### Why not keep the v1 pad editor reachable alongside the detail reader (a second tab type or a mode inside the tab)?

The proposal's §0.2 row is explicit: the seat stays, the function is replaced — v1 pad editing is succeeded by "import as canvas", whose M1 channel already exists. A second seat for the old editor splits the pad's future in two and keeps 580 lines of dead-end UI alive for a surface nobody is meant to use; git history holds it.

### Why not inline the html preview now (a read-asset verb + sandboxed srcdoc iframe)?

It needs a new Remote verb that reads canvas-asset files (a traversal-sensitive surface that needs the same sandbox care as every other write path), to render content no card can reference before M4 — there is no html-asset producer in M1/M1.5. The official `openResource` preview already covers html files today. Deferring keeps M1.5 at zero new verbs.

## Consequences

- `packages/canvas/src/types.ts`: `SUMMARY_CLAMP_LINES` / `SUMMARY_CLAMP_CHARS` / `MAX_DOCUMENT_TITLE_LENGTH`, `isLongCardText`, `documentHeadingOf` (+9 vocab tests).
- `packages/canvas/src/client/space/selection.ts` (new): `CanvasSelectionStore` over `createSnapshotStore`; devDep `@deepseek-ai/dsh-client-store` (no new runtime dependency — it bundles into `client.js`).
- `packages/canvas/src/client/space/CardTextarea.tsx` (new): the editor invariants extracted; `BoardView.tsx` and the detail reader share it.
- `packages/canvas/src/client/space/BoardView.tsx`: summary rendering (clamp/fade/words/doc heading), hover checkbox, body-click-opens-detail; ghost ✓/✗ now stop propagation (bodies are clickable).
- `packages/canvas/src/client/detail/` (new): `CanvasDetailView.tsx` + its CSS module — the right-Sidebar tab's new body.
- `packages/canvas/src/client/contract.ts`: `CanvasViewInjected`/`CanvasViewProps` replaced by `CanvasDetailInjected`/`CanvasDetailProps`; `CanvasSpaceInjected` gains `selectCard` + `hooks.selection`.
- `packages/canvas/src/client/index.ts`: the tab seat hosts the detail reader; `selectCard` = store select + `openTab` (try/catch degrade); face wrappers touch the store on landed mutations; `inject` gains `sidebarRight`.
- `definition.ts` guide copy and the dictionaries now describe the detail reader; `CanvasView.tsx`, `CanvasView.module.css`, and `tests/view-style.spec.ts` are deleted.
- Remote surface: **zero new verbs** — the whole slice is client-side plus pure vocabulary.
- Unused v1 pad locale keys (the pad editor's own copy) are left in place deliberately: pruning them is churn against keys the M4 paste flows will reuse; recorded here so it is not rediscovered as a smell.

## Testing

- `packages/canvas`: **134 tests green** (115 at M1's merge): `board-vocab.spec.ts` +9 (summary heuristics incl. the heading/body split and the prose-first-line fallback), `space.client.spec.tsx` 12 (checkbox multi-select replacing body-click-select, body-click → `selectCard`, word count + derived heading, the IME hard stop intact), `detail.client.spec.tsx` 10 new (empty state, full-text render, derived heading, selection follow without refetch, rev-touch re-read, ghost ✓, edit-toggle ⌘⏎ save, comment post, file attachment → `openFile`, archived restore) — the detail specs run a REAL `CanvasSelectionStore`, so the board↔detail contract is exercised, not mocked.
- `pnpm --filter @khorsheed/dsh-canvas build` (gen-typert → tsc → tsdown), `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins` green.
- NOT done: a live-browser pass on 3080 (deploys stay coordinated); the jsdom specs cover the wiring, and the clamp/fade styling is CSS-only.

## Deferred

- Inline html asset preview (sandboxed srcdoc iframe) + the `assets/` read verb — M4, when an html-asset producer exists.
- Paste-to-create, canvas renaming, attach-list editing, board polling beyond the rev channel (external edits still surface on the next gesture through the version guard).
- Locale dictionary pruning for the retired pad editor's keys (see Consequences).

## Related

- [M1 note](2026-09-16-canvas-space-m1.md) (the space, the state dir, the re-rooted fence).
- [canvas-space proposal](../../../proposals/active/2026-09-16-canvas-space.md) (§0.2 tab row, §3 摘要与详情分工, milestone M1.5).
