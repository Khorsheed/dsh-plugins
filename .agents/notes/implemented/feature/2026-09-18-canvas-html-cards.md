# Agent Note: canvas 0.4.3 — HTML cards render in the sandbox; format is a property of content, not kind

Status: implemented

English | [中文](2026-09-18-canvas-html-cards.zh.md)

## Problem

A 3080 screenshot made it concrete: an 8000-character reference card held a complete HTML document, and both the board and the detail page showed the raw markup as plain text — unreadable and exploding the card. The proposal's §8 always meant the canvas to double as a renderer (markdown AND pasted HTML), but until now HTML had no render path at all.

Two design questions shaped the slice. **Does HTML need a new card kind?** No — format is a property of the content, not the kind: a reference card may carry either markdown or HTML, and locking format to a kind would make the v1-imported documents (markdown files) and pasted HTML pretend to differ in kind when they differ in format. **How conservative is the detector?** A markdown card with inline HTML must stay markdown — the failure direction is always "miss real HTML", never "send prose to the sandbox".

## Decision

**Format detection is a pure, conservative heuristic in `src/card-format.ts`.** `detectCardFormat`: whole documents (`<!doctype html>`, `<html>`, `<head>`, `<body>` openers) always qualify; fragments qualify only when they are markup all the way down — they start with `<`, end with `>`, carry at least two open tags that close later, hold no line-level markdown block marker (heading/list/quote/fence), and are not merely inline tags inside prose. Everything else is markdown. `htmlTitleOf` extracts the `<title>` (entities decoded, length capped) for the display heading.

**The detail page renders HTML in the strict sandboxed iframe.** The render pane picks `HtmlFrame` when the card's format is html: `srcDoc={buildCardSrcDoc(text)}` (the card CSP: no network, no navigation, inline scripts only) plus `attachBridge(frame)` for link/copy/height-report, with the disposer in the effect cleanup and the frame keyed by card id (a card switch remounts cleanly). Split mode puts iframe and source textarea side by side; source mode is unchanged (raw text, edit, ⌘⏎ save). The header meta gains a small HTML format tag. Markdown cards are untouched.

**The board shows a compact placeholder, never the markup.** An html card's summary is: code icon + (the `<title>`-derived heading or the localized "HTML 文档 / HTML document" label) + the word count. Click-through and the hover checkbox are unchanged. The document-heading heuristic no longer misfires on HTML (a document card's title is its `<title>`, never the doctype opener).

**The render helpers arrive through the SOURCE plane, with zero runtime coupling.** `buildCardSrcDoc`/`attachBridge` import from `@khorsheed/dsh-inline-html-render/src/client/*` (the package's `./src/*` export); tsdown bundles them into canvas's `client.js` — the built bundle carries the bridge and CSP strings and contains NO runtime reference to the package (verified by a bundle smoke: no `require`/`from` of `@khorsheed/dsh-inline-html-render` in `lib/client.js`). An uninstalled renderer package cannot affect the canvas. The cross-package edge follows the checker's own prescription: `scripts/check-plugin-independence.ts`'s `ALLOWED_EDGES` gains the canvas → inline-html-render entry **deliberately** (its comment records the compile-time-only nature), and `package.json` carries the `workspace:*` devDependency. `pnpm check:plugins` and its spec stay green.

## Alternatives considered

### Why not a new card kind `html`?

Kind answers "what is this card FOR" (fragment/question/grounding/reference/document); format answers "what notation is the content in". A document card pasted from markdown and one pasted from HTML are the same kind. A new kind would split every kind-filtered surface and the stats vocabulary for a renderer concern — and the M4 artifact direction (a document card's renderer being one of several output shapes) is exactly format-not-kind.

### Why not hand-roll the sandbox instead of reusing inline-html-render?

The CSP-in-head dance (no CSP inheritance to rely on for srcdoc), the fragment-vs-document wrap, the opaque-origin sandbox, and the bridge's validated message handling are all subtle and already tested in that package. Copying them would fork a security boundary; importing the source plane keeps one implementation and no runtime coupling.

### Why not detect via an HTML parser instead of regexes?

A parser dependency (or the DOM) for a hot render path is a heavy answer to a yes/no question, and parsers are lenient in exactly the wrong direction for this gate (they accept broken markup, which markdown prose with angle brackets then "parses" as). The heuristic's job is a cheap conservative gate; the sandbox takes over once it says yes.

## Consequences

- `packages/canvas/src/card-format.ts` (new): `detectCardFormat` + `htmlTitleOf` + `MAX_HTML_TITLE_LENGTH` (+9 spec cases: documents, fragments, inline-HTML-in-markdown, plain text, empty).
- `packages/canvas/src/client/detail/CanvasDetailView.tsx`: `HtmlFrame` (sandbox + bridge + keyed remount); the render/split pane picks it for html; the header meta shows the HTML tag; document headings come from `<title>` on html.
- `packages/canvas/src/client/space/BoardView.tsx`: the html placeholder in `CardSummary` (icon + title + words).
- `packages/canvas/src/client/locales.ts`: `card.htmlDocument` + `detail.formatHtml` (both dictionaries).
- `packages/canvas/package.json` 0.4.2 → 0.4.3, devDep `@khorsheed/dsh-inline-html-render` `workspace:*`. `scripts/check-plugin-independence.ts`: the `canvas` → inline-html-render entry in `ALLOWED_EDGES` (deliberate, compile-time-only).
- The card data model and every Remote verb are untouched — format is never persisted, it is derived at render.
- On 3080 the screenshot's 8000-char reference card now renders as a document in the detail page and as a one-line placeholder on the board.

## Testing

- `packages/canvas`: **188 tests green** (186 before + 2 new UI cases): the detail spec gains the sandboxed-frame case (sandbox attr, CSP inside the srcDoc, content kept, raw markup never text-rendered); the tab spec gains the board placeholder case (title shown, markup absent). `card-format.spec.ts` covers the heuristic matrix.
- A real-HTML smoke against the built artifact: a document with `<title>`, an external image, and an inline script keeps its content, gains the strict CSP meta right after `<head>`, and carries the bridge — and `lib/client.js` contains the bundled helpers with zero runtime imports of the renderer package.
- `rm -rf lib` then `pnpm --filter @khorsheed/dsh-canvas build`, `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` all green.

## Deferred

- Paste-to-create (`text/html` → document card) and `assets/` for large HTML, html syntax highlighting in source mode, and the session-side search tools — M4.
- The detail's html frame has no toolbar (reload/open-external); if one is wanted it belongs to the shared renderer package, not to canvas.

## Related

- [Topbar note](2026-09-17-canvas-topbar-redesign.md) (the current tab structure this renders into).
- [M1.5 note](2026-09-16-canvas-space-m1-5.md) (the summary/detail split; html assets' full renderer stays M4 as recorded there).
- The canvas-space proposal §8 (the renderer direction this implements).
