# @khorsheed/dsh-canvas

English | [中文](README.md)

**Inspiration canvas (灵感画布)** — since v2, a **topic canvas space at the same level as workspaces**: one "Canvas" entry on the left rail opens a full-page surface pairing a canvas list column with the card board. One canvas = one topic = a deployment-level entity accumulating five card kinds — fragments, questions, grounding (shared understandings), references, documents; model proposals land on the board as ghost cards, and your ✓/✗ decides their fate.

The v1 workspace pad (the right-Sidebar tab: one inspiration = one markdown file) is **kept exactly as it is**, and when a v1 directory is detected the space offers a one-shot "import as canvas" (a read-only copy — the original files are never touched).

## The canvas space (v2, M1)

- **A full-page rail entry** (`sidebar.panellist` + keyed `main`): the left rail switches the whole main area to the canvas space, and the conversation is one click back. A canvas binds no workspace; it attaches 0..n workspace directories.
- **Deployment-level storage**: every canvas is one `$DSH_HOME/state/canvas/<canvasId>/canvas.json` (metadata + every card + counters) — plain JSON any editor can open. Uninstalling the plugin never deletes it.
- **Five content card kinds**: fragment (a thought) / question (open → exploring → answered lifecycle) / grounding (a shared understanding) / reference (with a source) / document. New cards edit inline, ⌘⏎ to confirm.
- **Ghost proposal cards**: a `proposed` card sits inline with a dashed ghost frame; "Accept" turns it into a real card, "Reject" archives it (**there is no delete**); the acceptance counters feed `stats` for the self-tuning rules of later milestones.
- **Filter, multi-select, archive**: kind filter chips (all/fragment/question/grounding/reference/document); click cards to multi-select and batch-archive from the selection bar; archived cards wait in the archive well, restorable any time.
- **Comments hang on cards**: a badge unfolds the thread; comments are data (in later milestones an agent comment moves an open question card to exploring automatically).
- **One-shot v1 import**: "Import a v1 pad" at the list's foot — pick a workspace, and when `<workspace>/灵感画布/` is found, copy it into a new canvas in one gesture (v1 cards → fragment cards, v1 articles → document cards, sources pointing back at the original absolute paths; **read-only — not one byte of the pad changes**; items already archived in the pad stay behind).
- **The editor invariants carry over from v1**: uncontrolled textareas (the caret never jumps), a hard stop while an IME composes (the candidate window is never torn down), and one scroll container for the whole board (card editors auto-grow and never scroll themselves).
- **Dark mode follows the theme**: every colour is an official `--dsw-*` token; kind is told by icon + words only, never by colour.

## The v1 pad (kept)

- **One inspiration = one file.** The originals live under `<workspace>/灵感画布/`, with `文章/` (articles) and `卡片/` (cards) as the two shapes and the file name as the title. No database, no private format.
- **A full-height writing surface** (a `sidebar.right.pane.tab` page-type tab): the inspiration list on the left (collapsible), edit / preview / split on the right. Switching to split collapses the list once, handing the width back to the text.
- **Paste a table, get a table.** Copying a table out of Excel, Numbers, a web page, or Word turns into a real markdown table (a real table in the preview). Anything it cannot read is **pasted as-is** — ordinary prose is never mangled. Space-aligned tables (PDFs, plain text) have an explicit “selection to table” action instead.
- **Copy the absolute path for the model.** The status line always shows the workspace-relative path (short, readable); the copy button yields the absolute one — because you reference a draft from **another session, even another workspace**.
- **Archive, never delete.** Archiving hides an item from the list and **does not touch the file at all** (the official session-archive semantics); the archive well restores it, to its recorded position.
- **Friendly to Chinese input**: no save and no re-render while an IME is composing, an uncontrolled editor so the caret never jumps, and auto-save behind a version guard (a change made elsewhere stops the save instead of being silently overwritten).

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas
# remove:
dsh plugin --profile web remove @khorsheed/dsh-canvas
```

Restart the host afterwards. Uninstalling does **not** delete `$DSH_HOME/state/canvas/` or any `灵感画布/` directory — your drafts and canvases are yours.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ complete — the right-Sidebar page-type tab (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab`) exists from 0.1.5, so `minHost` moved up with it; older hosts have no right Sidebar seat, so stay on the previous release line there.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)
- **The space's seats are probed**: the v2 `main` / `sidebar.panellist` registrations ride `ctx.slots.inject` — a host declaring neither seat simply never mounts the space, and the v1 tab is unaffected.
- **A web-surface plugin**: a headless profile has no browser consumer and this package contributes nothing there.
- The host half registers no model-facing tool and injects nothing into the prompt (the chat dock and the canvas tools land in later milestones).
- **v1 writes are fenced by the session that started the gesture.** All three write paths (new / save / archive) resolve the calling session's sandbox policy first, so the fence hangs on that session's own workspace rather than on the host process's directory. A read-only session therefore gets an explicit refusal (`that location is not writable`) instead of a silent write.
- **v2 board writes re-root the fence at the state dir.** A canvas is deployment-level state no session workspace can hold: board writes still ride the mounted `ctx.fs` (version guards, atomic writes, the observation trail), the calling session resolves the **mode** and lends its id (a read-only deployment still denies), but the writable boundary is re-rooted at the plugin's own `$DSH_HOME/state/canvas` — a workspace-write fence around exactly that directory, never a bare `node:fs` bypass. When `DSH_HOME` is unset the state root falls back to `process.cwd()` (the datasets precedent).

## Known Limitations

- **Archive only; there is no delete.** Official `ctx.fs` has no file-deletion route (none of its 13 abstract methods is `remove`/`rename`, and the sandbox fence hangs on `writeText`/`editText` only — a raw `node:fs` call would bypass it). To remove a file for good, remove it in your file manager; it is just a markdown file. Canvases are the same: archived canvases and cards stay inside `canvas.json`.
- **External editor changes are never announced.** Official `workspaceFiles.changes` reports instrumented filesystem operations and **does not watch the OS**; a draft edited in another program is only discovered by the version guard at save time. `canvas.json` is the same: a change from another browser tab is picked up on the next gesture (the service re-reads and re-applies once on a stale write); the page does not poll.
- **The list order lives in `.index.json`, not in modification times.** `ctx.fs` reports no mtime, so the index carries the order (new items first) and files it does not know are appended by name.
- **Cross-workspace reads only.** The model's `read` is not workspace-bound, so you can reference a workspace-A draft from a session in workspace B; but B's sandbox fences at B, so the model cannot write back into A.
- **Chinese directory name**: `git status` shows it as octal escapes under `core.quotepath` (harmless, alarming to look at). The host resolves everything through `ctx.fs` and never shells out, so non-ASCII and spaces are not a problem.
- **Merged HTML table cells degrade** to “text plus empty slots”; spans are not rebuilt.
- **M1's space does not** (later milestones): the chat dock and the per-canvas agent session (M2); the model tools and the stats-driven self-tuning rules (M3); the draft view, document-card rendering, session-side search tools, and the v1 right-Sidebar entry's removal (M4). M1 also ships no paste-to-create and no canvas renaming.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Canvas space (v2) on-disk layout**

```
$DSH_HOME/state/canvas/<canvasId>/
  canvas.json      # { id, title, attachedWorkspaces, chat, cards[], stats, archivedAt, … }
```

Each `cards[]` entry: `{ id, kind, text, source?, status: proposed|kept|archived, question?, comments[], createdBy, createdAt, updatedAt }`. `stats` records the proposal accept/reject counts, the visible per-kind card counts, and the last-activity instant (what the list orders by and the self-tuning rules will read). A corrupt file or an id that does not match its directory is **skipped by the list and refused by reads and writes** — a file the service cannot understand is never rewritten.

**The board service**: `CanvasBoardService` (`ctx.canvasBoard`) reads and writes the whole board under a version guard — read, apply a pure edit, write back with `replaceIfVersion`; a version conflict is **re-read and re-applied exactly once** before reporting `stale` (two browser tabs never lose each other's cards). The write fence is the "re-rooted" one described under Compatibility.

**Remote**: the `canvas` namespace keeps the v1 five verbs (`list` / `read` / `create` / `write` / `setArchived`) and adds the space's eight: `listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `importV1`. Every mutating verb takes the calling agent first (its session fences the write); reads take no agent — the v1 wire convention, unchanged.

**The space client**: `ctx.slots.inject('main')` registers the full-page panel under `key: 'canvas'`; `ctx.slots.inject('sidebar.panellist')` registers the rail row with the same id at order 100 (the host sidebar owns the row button and its active state; the plugin supplies the icon and the label). The page is root scope and owns no session: workspace context arrives through the global `useWorkspaces` hook, and the write fence rides the currently selected session (`useSessions`); both hooks carry a constant fallback, so a minimal composition (no ui-session / ui-workspace) still opens the space, read-only.

**v1 on-disk layout**

```
<workspace>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` mirrors the official workspace registry: `order` is the display order and `archivedIds` the archive set — the same two facts the official registry keeps as `workspaceIds` + `archivedSessionIds`. A missing or corrupt index **degrades** to name order with nothing archived; it never makes the pad unopenable.

**v1 host half**: `CanvasService` (the core) plus `CanvasRemoteService` (a Typert Remote). Five verbs, all **plain JSON, absolute-path arguments, no session lookup** (the local-files convention). Every write goes through the mounted `ctx.fs`, so the deployment's sandbox mode fences it and the observation policy sees it; the version guard is `writeText`'s `{ kind: 'replaceIfVersion' }`, and a conflict returns `stale` instead of overwriting.

**v1 browser half**: `ctx.remote.$mount` mounts the Remote, then registers the tab type (its `guide` capsule puts it on the official guide page, and when it is a pane's only registered type the official `defaultSeed` enters it directly) and the body on the keyed `sidebar.right.pane.tab`. With no host half (`ctx.get('remote.canvas')` is undefined) the browser half still registers and reports the missing half rather than failing boot.

**Three hard editor constraints** (in `CanvasView.tsx` and in the space's card editors alike, because breaking any one wrecks writing): an uncontrolled `<textarea>` whose `value` is never written back after mount; no save and no submit while an IME is composing; and exactly one scroll container — the pad textarea's, the board's own.

**Paste conversion** (`paste-table.ts`, pure functions): the `<table>` inside `text/html` is tried first (only the table, never the whole document — a spreadsheet's clipboard HTML carries the entire sheet and its styling), with tab-separated plain text as the fallback; insertion uses `document.execCommand('insertText')` to preserve the browser's native undo stack.

Configuration: the plugin row accepts `stateRoot` (a board state-root override; the default is `$DSH_HOME/state/canvas`, or `<cwd>/.dsh-canvas` when `DSH_HOME` is unset).

</details>
