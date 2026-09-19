# Agent Note: content search keeps the rendered document

Status: implemented

English | [中文](2026-09-17-rendered-content-search.zh.md)

## Problem

Both preview panes (the products pane in `ui-file-preview`, the workspace browser in `local-files`) shipped a content search that hijacked the view: the moment a query had a hit, the body was replaced by the raw matched-lines view — a plain `<pre>` with per-line `<mark>`s. The intent was visibility ("a hit must never be invisible"), and it was the only cheap option at the time: the official `MarkdownText` takes no highlight input at all (`text` / `streaming` / `labels` / `fileMentions` / `pathImages` only), its pipeline disables raw HTML, so a `<mark>` cannot be injected into the source; and `JsonTree` renders a collapsible inspector with no source-line coordinates to map back to.

The cost showed up in daily use (2026-09-17 screenshot): markdown source is noise for reading — `**`, `###`, table pipes — a JSON tree or CSV table collapsed back to raw text, the reading position was lost, and locating the hit inside a long line became work. The user's own framing: 搜索的时候…变成代码模式，有点难定位到关键字眼.

## Decision

**The rendered body stays; the hits are painted over it.** `rendered-search.ts` (one copy per package — the two panes are deliberate mirrors and no shared runtime package exists between them) collects `Range`s over the rendered subtree and registers them through the **CSS Custom Highlight API** (`CSS.highlights.set(name, new Highlight(...))`), styled by `::highlight()` rules in each pane's module CSS. Nothing React owns is mutated: no `<mark>` wrapping, no reconciliation hazard, and the `MutationObserver` that re-scans on DOM change can never observe its own paint (the registry paints, it does not mutate).

**The raw matched-lines view becomes the fallback, not the default.** A query can match only source syntax (`**`, `###`, a fence) or live inside a JSON node the tree has collapsed; those have no visible Range. The hook reports the visible hit count per query, and only a measured **zero** latches the raw view — for that query alone, so the next query measures again. Two caller rules make it work: the rendered body stays mounted while the query is unmeasured (its DOM is what gets scanned — falling back on the unmeasured frame measured the *fallback* view and latched a hit count for a body that was already gone, found by the pane test), and the counter/jump cursor read the painted occurrence count in the rendered body versus matched lines in the raw view.

**Chrome is not content.** The scan skips text under `button` (a code fence's copy label would otherwise count), and the format banner and truncation notice carry `data-dsh-search-skip`. The count therefore describes what the user can actually see.

**The HTML preview keeps the raw view.** Its rendered form is a sandboxed, opaque-origin iframe: its text is not in this DOM, so no Range can reach it. Every other text read — markdown, JSON tree, CSV table, plain code view — gets the painted treatment, which also means a code file keeps its syntax colors while searching instead of dropping to plain monospace.

**`:global()` around `::highlight()` is load-bearing.** lightningcss rewrites a `::highlight()` ident the way it rewrites a class — the first build emitted `::highlight(HMaBaG_dsh-file-search-hits)` against JS constants that still said `dsh-file-search-hits`, i.e. a silent no-paint. Wrapping the pseudo-element in `:global()` keeps the bare registry name on both sides; a build grep for the emitted name is the cheap check.

**Degradation is silent, not fatal.** Without the API (any non-Chromium host, jsdom) `supportsRenderedSearch()` is false and the panes behave exactly as before: search shows the raw matched-lines view.

## Alternatives considered

### Why not wrap the matched text nodes in `<mark>` (the classic find-in-page approach)?

It mutates DOM that React owns. Markdown, `JsonTree` and `CodeBlock` re-render on their own schedules (a streaming fence, a tree expansion), and React removes/replaces text nodes positionally — an injected element between them turns a routine update into "the node to be removed is not a child of this node". The Highlight API gets the same paint with zero ownership conflict; the only price is browser support, which Chromium has had since 105.

### Why not add a highlight pass to the official `MarkdownText` (a prop that wraps matches)?

That is an upstream change to a package we do not own, and it would only cover markdown: the JSON tree, the CSV table and `CodeBlock` would each need their own. The DOM-level Range scan covers every rendered form at once, which is also why the same code serves both panes unchanged.

### Why not inject `<mark>` into the markdown source before parsing?

The official pipeline disables raw HTML by design (untrusted content), so the marker reaches the user as literal text. Relaxing that for our own preview would trade a rendering convenience for the security property the shared renderer exists to hold.

### Why not keep the raw view as the default and add a 源码/渲染 toggle?

That is the smaller change, and it does not solve the complaint: in the rendered view a query would have no visible hits at all, so the user would still be flipping modes to find anything. The user chose the painted-rendered route explicitly when asked (2026-09-17).

### Why not share one implementation between the two packages?

The package conventions require every plugin to install and run alone; a shared module would either become a new package (an extra dependency for both) or an intra-repo import across plugins, which `pnpm check:plugins` rejects. The two panes are already deliberate mirrors (the local-files header says so), and the duplication is one file of pure functions plus a hook.

## Consequences

- New `src/client/rendered-search.ts` in `packages/local-files` and `packages/ui-file-preview`; new `tests/rendered-search.client.spec.tsx` and a pane-level search spec in each.
- `DetailPane.tsx` / `FilePreviewPane.tsx`: the search state now derives `canPaint` / `painted` / `total` / `rawSearch`; `PreviewBody` takes `rawSearch` instead of recomputing it; the format banner and truncation notice carry `data-dsh-search-skip`; the ui-file-preview pane gained a `contentRef` for the rendered body.
- `local-files/tsconfig.client.json` lists the new source file (its explicit `files` list fails the build otherwise).
- The counter's unit changed meaning in painted mode: it counts visible occurrences, not matched source lines (raw mode still counts lines). A query matching twice on one line reports 2 painted, 1 raw.
- `::highlight()` styling is limited to color / background-color / text-decoration / text-shadow — no radius or padding, so the painted hits read slightly flatter than the raw view's `<mark>`; the active hit is told apart by a darker fill (`--dsw-static-deepseek-600`) plus an underline.
- Painted hits are capped at 2000 ranges (the count is uncapped) so a one-character query over a large file cannot paint tens of thousands of ranges.
- Not delivered: a hit count for the sandboxed HTML render (structurally out of reach), and any search inside `DiffHistory`.

## Testing

- `packages/local-files`: 41 tests green — the 9 new `rendered-search` cases (scan chrome/text-node skipping, paint/clear under a stubbed registry, the no-API branch, the hook's count and fallback latch) plus a 4-case `DetailPane` spec proving the rendered markdown stays mounted and the hits register, `**` falls back to the raw view with its `<mark>`s, a no-hit query keeps the document with the no-match label, and the format banner is not counted as a hit.
- `packages/ui-file-preview`: 107 tests green — the same 9 module cases and the same 4 pane cases against `FilePreviewPane`.
- Both packages build (`tsc` + `tsdown`) and the emitted client bundles carry the bare `dsh-file-search-hits` / `dsh-file-search-active` names in their injected CSS.
- NOT verified in a browser on 3080 (deploys stay coordinated): the Highlight paint itself, the active-hit scroll, and the JSON-tree expansion re-scan are covered at the face level only.

## Related

- [file-preview side drawer](2026-08-14-file-preview-side-drawer.md) (the pane stack this search lives in).
- [local-files standalone plugin](2026-08-28-local-files-standalone-plugin.md) (why the two panes are mirrors without a shared package).
- [ui-file-preview sidebar-right S1 retirement](../architecture/2026-09-10-ui-file-preview-sidebar-right-s1-retirement.md).
