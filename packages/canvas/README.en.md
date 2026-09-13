# @khorsheed/dsh-canvas

English | [中文](README.md)

**Inspiration canvas (灵感画布)** — a workspace-level pad for the writing case. One inspiration is one markdown file in your work's folder; one right-Sidebar pane puts the list on the left and edit / preview / split on the right. When you are done, copy the path, paste it into the conversation, and the model reads it itself.

This is not a text box next to a chat: your drafts are your files, openable, backable-up, and handable-over with any other tool.

## Features

- **One inspiration = one file.** The originals live under `<workspace>/灵感画布/`, with `文章/` (articles) and `卡片/` (cards) as the two shapes and the file name as the title. No database, no private format.
- **A full-height writing surface** (a `sidebar.right.pane.tab` page-type tab): the inspiration list on the left (collapsible), edit / preview / split on the right. Switching to split collapses the list once, handing the width back to the text.
- **Paste a table, get a table.** Copying a table out of Excel, Numbers, a web page, or Word turns into a real markdown table (a real table in the preview). Anything it cannot read is **pasted as-is** — ordinary prose is never mangled. Space-aligned tables (PDFs, plain text) have an explicit “selection to table” action instead.
- **Copy the absolute path for the model.** The status line always shows the workspace-relative path (short, readable); the copy button yields the absolute one — because you reference a draft from **another session, even another workspace**.
- **Archive, never delete.** Archiving hides an item from the list and **does not touch the file at all** (the official session-archive semantics); the archive well restores it, to its recorded position.
- **Friendly to Chinese input**: no save and no re-render while an IME is composing, an uncontrolled editor so the caret never jumps, and auto-save behind a version guard (a change made elsewhere stops the save instead of being silently overwritten).
- **Dark mode follows the theme**: every colour is an official `--dsw-*` token, none is hardcoded.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas
# remove:
dsh plugin --profile web remove @khorsheed/dsh-canvas
```

Restart the host afterwards. Uninstalling does **not** delete the `灵感画布/` directory — your drafts are yours.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ complete — the right-Sidebar page-type tab (`ctx.sidebarRightTabs` + the keyed `sidebar.right.pane.tab`) exists from 0.1.5, so `minHost` moved up with it; older hosts have no right Sidebar seat, so stay on the previous release line there.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)
- **A web-surface plugin**: a headless profile has no browser consumer and this package contributes nothing there.
- The host half registers no model-facing tool and injects nothing into the prompt (the v1 contract is copy-the-path-by-hand).

## Known Limitations

- **Archive only; there is no delete.** Official `ctx.fs` has no file-deletion route (none of its 13 abstract methods is `remove`/`rename`, and the sandbox fence hangs on `writeText`/`editText` only — a raw `node:fs` call would bypass it). To remove a file for good, remove it in your file manager; it is just a markdown file.
- **External editor changes are never announced.** Official `workspaceFiles.changes` reports instrumented filesystem operations and **does not watch the OS**; a draft edited in another program is only discovered by the version guard at save time.
- **The list order lives in `.index.json`, not in modification times.** `ctx.fs` reports no mtime, so the index carries the order (new items first) and files it does not know are appended by name.
- **Cross-workspace reads only.** The model's `read` is not workspace-bound, so you can reference a workspace-A draft from a session in workspace B; but B's sandbox fences at B, so the model cannot write back into A.
- **Chinese directory name**: `git status` shows it as octal escapes under `core.quotepath` (harmless, alarming to look at). The host resolves everything through `ctx.fs` and never shells out, so non-ASCII and spaces are not a problem.
- **Merged HTML table cells degrade** to “text plus empty slots”; spans are not rebuilt.
- v1 **does not** ship: model-facing tools, automatic draft injection into the prompt, candidate-draft diffs, or a free-form card canvas.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**On-disk layout**

```
<workspace>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` mirrors the official workspace registry: `order` is the display order and `archivedIds` the archive set — the same two facts the official registry keeps as `workspaceIds` + `archivedSessionIds`. A missing or corrupt index **degrades** to name order with nothing archived; it never makes the pad unopenable.

**Host half**: `CanvasService` (the core) plus `CanvasRemoteService` (a Typert Remote under the `canvas` namespace). Five methods — `list` / `read` / `create` / `write` / `setArchived` — all **plain JSON, absolute-path arguments, no session lookup** (the local-files convention). Every write goes through the mounted `ctx.fs`, so the deployment's sandbox mode fences it and the observation policy sees it; the version guard is `writeText`'s `{ kind: 'replaceIfVersion' }`, and a conflict returns `stale` instead of overwriting.

**Browser half**: `ctx.remote.$mount` mounts the Remote, then registers the tab type (its `guide` capsule puts it on the official guide page, and when it is a pane's only registered type the official `defaultSeed` enters it directly) and the body on the keyed `sidebar.right.pane.tab`. With no host half (`ctx.get('remote.canvas')` is undefined) the browser half still registers and reports the missing half rather than failing boot.

**Three hard editor constraints** (all in `CanvasView.tsx`, because breaking any one wrecks writing): an uncontrolled `<textarea>` keyed by a load token, whose `value` is never written back after mount; no save and no preview update while an IME is composing; and exactly one scroll container — the textarea's.

**Paste conversion** (`paste-table.ts`, pure functions): the `<table>` inside `text/html` is tried first (only the table, never the whole document — a spreadsheet's clipboard HTML carries the entire sheet and its styling), with tab-separated plain text as the fallback; insertion uses `document.execCommand('insertText')` to preserve the browser's native undo stack.

No configuration.

</details>
