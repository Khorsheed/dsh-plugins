# @khorsheed/dsh-canvas

English | [中文](README.md)

**Inspiration canvas （灵感画布）** — **a writing workbench in the right Sidebar**: one "Canvas" tab at a user-adjustable width (the resize handle plus a one-shot collapse-the-session-list suggestion), with a canvas switcher in its topbar, drill navigation between the board and the card detail, and the draft editor one toggle away. One canvas = one topic = a deployment-level entity accumulating five card kinds — fragments, questions, grounding (shared understandings), references, documents; model proposals land on the board as ghost cards, and your ✓/✗ decides their fate.

**Two conversation entrances** (M2–M3): **the current session** — two canvas tools (`canvas_propose_card` / `canvas_comment`) registered on the main agent, so you ask the agent to edit the canvas you have open; **the side-chat plugin** — the lenses' "Ask about these" and comment "Follow up" go to a second opinion (its own context; without side-chat every chat entry hides and the board keeps working). Text selections are owned app-wide by the quote plugin (@khorsheed/dsh-quote: quote to the current session / to the side chat / copy).

The v1 workspace pad's **storage is kept exactly as it is** (the editor retired) — the files stay on disk, openable by any editor, and the v1 five Remote verbs stay on the wire untouched.

> Route note: M1–M2.5 tried a main-panel space route, since retired — the host's `RightbarRoot` renders the right Sidebar for the conversation panel only, so a custom main panel makes every right-Sidebar surface fail by construction; the tab is the answer isomorphic with the host's layout. The data model, Remote, board/detail components, and side-chat integration all carried over.

## Features

- **Plain panel + one collapse suggestion** (corrected in M3.1): opening the canvas tab suggests collapsing the session list once per session (DOM-gated, never a blind toggle, never re-forced); the panel stays in the normal track mode — the resize handle works, the width is yours, and the layout remembers (a fullscreen suggestion shipped in M3 and was reverted: the host's fullscreen hides the resize handle). The single seat is the right-Sidebar page tab (`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`), session-scoped by construction.
- **One-screen topbar**: the canvas switcher dropdown (active rows → archived well → a bottom "+ New canvas" inline create row) + attached-workspace chips + the [board|draft] view switch + the new-card menu. No separate navigation column.
- **Deployment-level storage**: every canvas is one directory at `$DSH_HOME/state/canvas/<canvasId>/` — `canvas.json` (metadata + every card + counters) and `draft.md` (the manuscript), plain text any editor can open. Uninstalling the plugin never deletes it.
- **Five content card kinds**: fragment (a thought) / question (open → exploring → answered lifecycle) / grounding (a shared understanding) / reference (with a source) / document. All five edit in the detail page: "+ New card" hands its draft over there, ⌘⏎ saves and Esc returns (a confirmation appears only when the draft holds words or ink).
- **Summary/detail split** (M1.5): every board card renders a summary — clamped at ~6 lines with a fade, long texts carry a word count; document cards lead with a derived heading (the first markdown heading or first line) instead of the raw `#` opener. Multi-select moved to a **hover checkbox** in the card's corner.
- **The drill detail page** (M3): clicking a body drills into the detail (a back button returns) — kind icon + status + source + times, **render / source / split** tri-state (`MarkdownText` full render, the v1 editor invariants for source editing, split when the width allows), the comment thread (readable and postable), ghost ✓/✗, and the attachment area (url link; a file attachment opens the official document preview). The board itself is read-only: the only way to change a card's words is to open the detail page (the "+ New card" draft included).
- **Pasting md / html / tables / images in the detail page**: this is the one place in the plugin that reads the clipboard, and every landing is decided against the whole card the paste would produce (a card's format is sniffed from the full text by the renderer, never from a flag). Five arms — a whole HTML page / a table / markup only / rich text that fell back to plain words (with the reason stated) / handed back to the browser's native paste. A pasted **image** sends its pixels to the host's attachment store and puts one pointer line in the card (`![](attachment://…)` for a markdown card, `<img src="attachment://…">` for an HTML one); both renderers turn that pointer back into the picture.
- **Free-hand drawing in the detail page**: the card detail page carries a pen — draw on a 3:2 field, and the eraser takes one WHOLE stroke at a time (the stroke it would take lights up under the pointer first), with "Undo stroke" and "Clear" on the same strip; Esc puts the pen away and ⌘⏎ saves the draft. After the pen is down the field stays in place as a read-only figure with "Click to keep drawing" — a drawing is part of the card and must not vanish when you stop making it. What is stored is the POINT LIST (units of a 600×400 logical box, never screen pixels) and the outline is derived at render, so a stroke drawn in a narrow panel lands in the same place it is read in a wide one; a finished stroke writes itself (a draft stroke joins the draft), so there is no "unsaved drawing" state. The board shows it as a thumbnail and the model's `<board>` block carries its coordinates.
- **HTML card rendering** (0.4.3): format is decoupled from kind — `detectCardFormat` is a conservative heuristic (rather miss than misjudge: inline HTML inside markdown stays markdown); an HTML card renders in the detail page as a **strictly sandboxed offline iframe** (inline-html-render's srcdoc/bridge helpers, bundled from their source plane with zero runtime coupling), while the board shows a compact placeholder (the `<title>`-derived heading or "HTML document" + a word count) — the raw markup is never pasted as plain text again. Card text caps at 256KB (whole-board reads/writes stay millisecond-cheap; bigger content goes to `assets/` in M4). **The model boundary**: an HTML card's content never enters the model context in full — the agent sees the title and a pointer (and asks you to paste an excerpt when it needs one); a long markdown card is capped at 4000 chars with the truncation stated.
- **The draft view** (M3): one toggle to the manuscript — an edit / preview / split editor over `draft.md` with debounced auto-save behind a version guard (a change made elsewhere stops the save instead of being silently overwritten) and the IME hard stop.
- **Chat integration** (M2, via the side-chat plugin): the **lens bar** on a selection — challenge assumptions / find counterexamples / find evidence / ask why / another angle / abstract up / give examples, plus "Ask about these"; "Follow up" on agent comments; text selections belong to the quote plugin. One canvas = one side-chat context (`canvas:<id>`) = one persistent agent session, its system prompt fresh per turn (topic + board summary + tool contract + lens semantics + the grounding guardrail + stats feedback). **Without side-chat every chat entry hides and the board keeps working.**
- **Main-session tools** (M3): `canvas_propose_card` (a proposed card awaiting your ✓/✗) and `canvas_comment` (a comment that names an assumption or tension and ends with a question) registered on the main agent — the open canvas is the target (the tab reports it on every switch); with no canvas open the tools say so instead of guessing.
- **Ghost proposal cards**: a `proposed` card sits inline with a dashed ghost frame; "Accept" turns it into a real card, "Reject" archives it (**there is no delete**); the acceptance counters feed `stats` for the self-tuning rules of later milestones.
- **Filter, multi-select, archive**: kind filter chips (all/fragment/question/grounding/reference/document); checkbox multi-select with batch archive from the selection bar; archived cards wait in the archive well, restorable any time.
- **Comments hang on cards**: a badge unfolds the thread; comments are data (an agent comment moves an open question card to exploring automatically).
- **The editor invariants carry over from v1**: uncontrolled textareas (the caret never jumps), a hard stop while an IME composes (the candidate window is never torn down), and one scroll container.
- **Dark mode follows the theme**: every colour is an official `--dsw-*` token; kind is told by icon + words only, never by colour.

## The v1 pad (storage kept, editor retired)

- **One inspiration = one file.** The originals live under `<workspace>/灵感画布/`, with `文章/` (articles) and `卡片/` (cards) as the two shapes and the file name as the title. No database, no private format.
- **Since M1.5 the right-Sidebar tab is no longer the pad editor** (it is now the canvas workbench): the files stay on disk, openable by any editor; the v1 five Remote verbs (`list` / `read` / `create` / `write` / `setArchived`) stay on the wire untouched.
- **Archive, never delete** (the same semantics in the canvas and the pad): archiving hides an item from the list and **does not touch the file at all**; the archive well restores it.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas
# remove:
dsh plugin --profile web remove @khorsheed/dsh-canvas
```

Restart the host afterwards. Uninstalling does **not** delete `$DSH_HOME/state/canvas/` or any `灵感画布/` directory — your drafts and canvases are yours.

## Scoping the session tools to a preset (0.4.2+)

The two canvas tools (`canvas_propose_card` / `canvas_comment`) and their English guidance section live in a separate `./agent` composition entry instead of the profile root. The shipped `cordis.patch.yml` mounts it as a second row — **every session of every preset gets the tools** (the pre-0.4.2 status quo). To grant them to one mode only (e.g. `dsh-writing`):

```yaml
# <profile>/cordis.patch.yml: disable the root row
- id: canvas-agent
  disabled: true
```

```yaml
# ~/.dsh-official/.agent-presets/dsh-writing/agent.cordis.yml: grant inside the preset
- id: canvas-agent
  name: "@khorsheed/dsh-canvas/agent"
```

**The two must never be live at once** (the tools would register twice under the same names — the local-agent family's established pattern). Sessions without the preset see no canvas guidance in their system prompt and no canvas_* tools in their catalog. When the entry probes no `canvasBoard` (the core row is not mounted) it only warns and registers nothing — the composition still loads.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ complete — the right-Sidebar page-type tab (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab`) exists from 0.1.5, so `minHost` moved up with it; older hosts have no right Sidebar seat, so stay on the previous release line there.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)
- **A web-surface plugin**: a headless profile has no browser consumer and this package contributes nothing there.
- **The main-session canvas tools** register through the separate `./agent` composition entry (the shipped patch defaults to every session; preset-scoping above; origin tag carried); the target canvas resolves per session from the focused canvas (the one the right-Sidebar tab has open), and with no canvas open the tools answer a plain message instead of failing. **Chat depends on the side-chat plugin, non-fatally**: probed through `ctx.get('sideChat')` (a one-way edge, declared in the manifest's `dsh.references`); without it every chat entry hides and the board keeps working.
- **v1 writes are fenced by the session that started the gesture.** All three write paths (new / save / archive) resolve the calling session's sandbox policy first, so the fence hangs on that session's own workspace rather than on the host process's directory. A read-only session therefore gets an explicit refusal (`that location is not writable`) instead of a silent write.
- **v2 board and draft writes re-root the fence at the state dir.** A canvas is deployment-level state no session workspace can hold: writes still ride the mounted `ctx.fs` (version guards, atomic writes, the observation trail), the calling session resolves the **mode** and lends its id (a read-only deployment still denies), but the writable boundary is re-rooted at the plugin's own `$DSH_HOME/state/canvas` — a workspace-write fence around exactly that directory, never a bare `node:fs` bypass. When `DSH_HOME` is unset the state root falls back to `process.cwd()` (the datasets precedent). The canvas tools' writes ride the same fence (preferring the executing agent's own session).
- **Pasted images go to the host's attachment store**: probed through `ctx.get('attachments')` (`@deepseek-ai/dsh-attachment`, declared as an optional peer). The pixels land in the host's content-addressed store and the card keeps only one `attachment://…` pointer line (every field in it is something the host re-checks when reading the bytes back); a deployment without the store degrades the image entry on its own — one notice per paste ("this deployment has no image store") and text paste keeps working exactly as before. The render side knows that single scheme and nothing else: a local path typed into a card by hand never becomes a file request (risk ⑬).
- **Free-hand drawing reaches for nothing in the host**: strokes live on the card as a point list (units of the 600×400 logical box) and the outline library, `perfect-freehand` (MIT, zero dependencies), is bundled into `lib/client.js` by tsdown — no extra install, no file, no attachment store involved.

## Known Limitations

- **Archive only; there is no delete.** Official `ctx.fs` has no file-deletion route (none of its 13 abstract methods is `remove`/`rename`, and the sandbox fence hangs on `writeText`/`editText` only — a raw `node:fs` call would bypass it). To remove a file for good, remove it in your file manager; it is just a markdown file. Canvases are the same: archived canvases and cards stay inside `canvas.json`.
- **Pasted pixels are never garbage-collected.** The bytes live in the host's content-addressed store, and neither archiving a canvas nor deleting a card touches it — the files sit in the host's attachment directory until someone cleans up host side (this plugin has no delete route, see the bullet above). When a pointer's object cannot be read back, the image degrades to its alt text: no error, no broken-image icon.
- **Only pasted pictures render.** The render side admits the `attachment://` scheme and nothing else, so a hand-typed path such as `./pic.png` stays alt text forever (that whitelist is risk ⑬'s design). To get an image into a card, paste it.
- **A picture's bytes cross the Remote once.** On a cache miss the bytes travel as base64 in a single read; up to 24 pointers stay cached after that and the least-recently-used one goes when the 25th arrives. A long card with many images therefore paints text first and fills the pictures in one by one.
- **A drawing caps at 60 strokes, 120 points per stroke.** Hitting the cap says so rather than silently truncating (undoing or erasing a stroke frees room). The point list is stored and the outline is derived per render, so a later change to the line rules reaches old drawings on its own — at the cost of one computation per repaint.
- **Stroke width comes from speed, not pressure.** A mouse has no pressure to read (fast is thin, slow is thick); real pressure from a trackpad or stylus is not wired up yet.
- **The model reads coordinates, not pixels.** A drawing travels in the prompt's `<board>` block as a point list: the agent can reason about the geometry but never sees "an image". Letting it use a card's drawing as a multimodal reference still needs an export path (not built).
- **External editor changes are never announced.** Official `workspaceFiles.changes` reports instrumented filesystem operations and **does not watch the OS**; a draft or `canvas.json`/`draft.md` edited in another program is only discovered by the version guard at save time; the page does not poll.
- **The list order lives in `.index.json`, not in modification times.** `ctx.fs` reports no mtime, so the index carries the order (new items first) and files it does not know are appended by name.
- **Cross-workspace reads only.** The model's `read` is not workspace-bound, so you can reference a workspace-A draft from a session in workspace B; but B's sandbox fences at B, so the model cannot write back into A.
- **Chinese directory name**: `git status` shows it as octal escapes under `core.quotepath` (harmless, alarming to look at). The host resolves everything through `ctx.fs` and never shells out, so non-ASCII and spaces are not a problem.
- **Merged HTML table cells degrade** to “text plus empty slots”; spans are not rebuilt.
- **Still not** (later milestones): `canvas_propose_draft` with the candidate-diff flow, the stats-driven self-tuning rules, and web search wiring (later M3); paste-to-create (`text/html` → document cards) with `assets/` for large files, html syntax highlighting in source editing, and the session-side search tools (M4). There is still no canvas renaming.
- **The canvas agent's cwd follows side-chat's inheritance rule** (the calling session's cwd) — not the "first attached workspace or the canvas directory" the proposal imagines; that rule belongs to the side-chat package and the canvas does not reach across to change it.
- **Ghost cards appear through the client's turn watch** (polling the side-chat status after a send and triggering a re-read); after the watch ends, or for edits from another browser tab, the version guard still surfaces changes on the next gesture — the board does not poll standing.
- **The collapse is a one-shot suggestion**: on first visibility the tab suggests collapsing the session list once per session (`toggleSidebar()`, gated on the frame's own DOM marker), then the layout is the user's; fullscreen is never suggested (the host's fullscreen hides the panel's resize handle — a per-tab presentation seam is an upstream candidate).

## How it works

<details>
<summary>Internals (click to expand)</summary>

**On-disk layout (v2)**

```
$DSH_HOME/state/canvas/<canvasId>/
  canvas.json      # { id, title, attachedWorkspaces, chat, cards[], stats, archivedAt, … }
  draft.md         # the manuscript (plain markdown)
```

Each `cards[]` entry: `{ id, kind, text, source?, status: proposed|kept|archived, question?, comments[], draw?, createdBy, createdAt, updatedAt }`, where `draw` is `[{ pts: [{x,y,w}], color }]` — point lists in the units of the logical 600×400 box. `stats` records the proposal accept/reject counts, the visible per-kind card counts, and the last-activity instant (what the list orders by and the self-tuning rules will read). A corrupt file or an id that does not match its directory is **skipped by the list and refused by reads and writes** — a file the service cannot understand is never rewritten.

**The board service**: `CanvasBoardService` (`ctx.canvasBoard`) reads and writes the whole board under a version guard — read, apply a pure edit, write back with `replaceIfVersion`; a version conflict is **re-read and re-applied exactly once** before reporting `stale` (two browser tabs never lose each other's cards). The write fence is the "re-rooted" one described under Compatibility.

**Remote**: the `canvas` namespace keeps the v1 five verbs (`list` / `read` / `create` / `write` / `setArchived`) plus the space verbs: `listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `askAgent` / `chatStatus` / `focusCanvas` / `readDraft` / `writeDraft`. Every mutating verb takes the calling agent first (its session fences the write); reads take no agent — the v1 wire convention, unchanged.

**The right-Sidebar tab (M3)**: `ctx.sidebarRightTabs.register` for the type plus the keyed `sidebar.right.pane.tab` body (`tab/CanvasTab.tsx`). The topbar = the switcher (`tab/CanvasSwitcher.tsx`) + attach chips + the [board|draft] switch + the new-card menu; the board page = `space/BoardView.tsx`; the drill detail page reuses `detail/CanvasDetailView.tsx` (render/source/split); the draft page = `tab/DraftView.tsx` (driven by readDraft/writeDraft). The open canvas and the drilled card ride the shared selection store (`space/selection.ts`'s `{ canvasId, cardId, rev }`); the tab reports every open/switch through `focusCanvas` (the main-session tools' target); the collapse suggestion (`toggleSidebar()` gated on the frame's `data-sidebar-collapsed` marker) fires once per session (the M3 fullscreen suggestion was reverted in M3.1: the host's fullscreen hides the panel's resize handle). Either side's mutating verbs `touch()` the store's rev in the apply-level wrappers, so every reader re-reads.

**Chat integration (M2)**: the agent-first `askAgent` verb probes `ctx.get('sideChat')` and calls `openWith({ contextKey: canvas:<id>, label: topic, systemPrompt, tools, refs })` — `prompt.ts` renders the segment as a pure function (topic and goal / the board summary / the grounding guardrail / the tool contract / lens semantics / the stats feedback section), and `tools.ts` builds the two `defineTool` definitions (the origin tag rides the documented no-import `Symbol.for('dsh.tool.origin')` property). The send rule: a free text wins, else a non-`ask` lens's template, else prime-only. The client asks from two places (the lens bar / comment "Follow up"); selection interactions belong to the quote plugin, with the `chatStatus` probe gating every chat entry; after a send it watches `remote.sidechat.getState` (structural mirror), touching the shared rev while the turn runs so ghost cards appear as the agent's tool calls land.

**Main-session tools (M3; via `./agent` since 0.4.2)**: `tools.ts`'s `canvasMainSessionToolDefinitions` register from the `src/agent.ts` composition entry through `ctx.inject(['tools'])` (deferred — the datasets-tool precedent; the shipped patch mounts it at root, or a preset's `agent.cordis.yml` for scoping), with the English `canvas:tools` prompt section; the target canvas is `ctx.canvasBoard.focusedCanvasId(session)` (reported by the tab through `focusCanvas`), and no focus answers a "no canvas open" message. The origin tag rides the same no-import path. The right-sidebar tab TYPE self-hides at the registration level on "can this session reach the canvas tools" — a two-path criterion: an ENABLED root-mounted `@khorsheed/dsh-canvas/agent` row means visible for every session (the community default); otherwise the current session's preset composition must name the row (the preset-mounted shape, e.g. 3080's dsh-writing recipe); every unreadable path fails open. The 2026-09-16 incident's lesson was never "no preset gate on the entry" but "never check ONLY the preset slice": with a root-mounted row nothing preset-scoped names it, and a single-path check hides the entry forever.

**v1 on-disk layout**

```
<workspace>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` mirrors the official workspace registry: `order` is the display order and `archivedIds` the archive set — the same two facts the official registry keeps as `workspaceIds` + `archivedSessionIds`. A missing or corrupt index **degrades** to name order with nothing archived; it never makes the pad unopenable.

**v1 host half**: `CanvasService` (the core) plus `CanvasRemoteService` (a Typert Remote). Five verbs, all **plain JSON, absolute-path arguments, no session lookup** (the local-files convention). Every write goes through the mounted `ctx.fs`, so the deployment's sandbox mode fences it and the observation policy sees it; the version guard is `writeText`'s `{ kind: 'replaceIfVersion' }`, and a conflict returns `stale` instead of overwriting.

**Three hard editor constraints** (implemented in `space/CardTextarea.tsx` and `tab/DraftView.tsx`, because breaking any one wrecks writing): an uncontrolled `<textarea>` whose `value` is never written back after mount; no save and no submit while an IME is composing; and exactly one scroll container — the editor's own.

**Paste conversion** (`paste-table.ts`, pure functions): the `<table>` inside `text/html` is tried first (only the table, never the whole document — a spreadsheet's clipboard HTML carries the entire sheet and its styling), with tab-separated plain text as the fallback; insertion uses `document.execCommand('insertText')` to preserve the browser's native undo stack.

**Reading pictures back** (`client/images.ts`): the host's `MarkdownPathImages.resolve` is **synchronous** while the byte read is asynchronous. So the `CanvasImageSrcs` cache holds one map of "pointer → data URL" (24 entries, least-recently-used out, and a failed read is remembered too so a repaint does not re-read it) plus a revision number. The tab subscribes to that revision and mints a fresh `pathImages` object whenever it moves — `MarkdownText` is memoized, so only a new object identity repaints it; the detail page and the draft page just take that prop and subscribe to nothing. An HTML card has no `pathImages` to accept, so `rewriteImageSrcs` rewrites its `src` attributes instead. A `data:` URL was chosen over a blob object URL on purpose: no revoke lifecycle, no orphaned objects, and eviction is a plain map delete.

**Drawing** (`client/draw.ts` pure functions + `detail/CardPad.tsx` the field + `detail/DrawFigure.tsx` the figure): coordinate mapping, sampling, width, eraser hits and outline export all live on the pure half — every one of those rules is one a person disputes after drawing a single line, and a number is cheaper to argue with than a screenshot. The point list is stored and the outline never is (measured on one 24-point stroke: 287 B as points, 834 B as an outline); `perfect-freehand` derives it at render (MIT, zero dependencies, bundled into `lib/client.js` by tsdown, so nothing extra is installed at the deployment). A finished stroke writes the whole list back through `patchCard` under the same version guard, which is why the pen has neither a dirty flag nor its own save button; `draw: []` means "cleared" and must stay distinguishable from "no `draw` key — leave it alone". A drawing is CONTENT: a card with ink and no words can be created, and the discard confirmation therefore counts words OR strokes.

Configuration: the plugin row accepts `stateRoot` (a board state-root override; the default is `$DSH_HOME/state/canvas`, or `<cwd>/.dsh-canvas` when `DSH_HOME` is unset).

</details>
