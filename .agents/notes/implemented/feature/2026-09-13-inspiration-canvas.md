# Agent Note: Inspiration canvas — a workspace-level writing pad the model can read

Status: implemented

## Problem

A writer using the harness needs somewhere to put a first draft or a heap of fragments, and then a way to let the model read it. The chat composer is the wrong place: a draft written there is buried in the transcript, has no name, no version, and is re-sent on every subsequent turn. The existing surfaces do not cover it either — the official workspace file tree and `@khorsheed/dsh-local-files` are read-only browsers, and asking the model to write the file means the operator is not the one writing.

Three facts about the host decide the shape of the answer, all measured before the design was fixed:

1. `ctx.fs.writeText(target, content, expected?)` already carries a guarded write (`{ kind: 'createIfAbsent' }` / `{ kind: 'replaceIfVersion' }`) and returns `before`/`after` as a diff basis, and `writeFileAtomic` creates parent directories recursively. Creating, collision-refusal and stale-write protection need no new machinery.
2. There is **no** file-deletion route anywhere: none of `FileSystem`'s 13 abstract methods is `remove`/`rename`, `workspace-controller`'s `@Remote('delete')` removes a *workspace registration* while retaining files, and `SandboxedFileSystem` fences only `writeText`/`editText` — so a raw `node:fs.rm` would bypass the sandbox fence rather than merely miss a notification.
3. The agent's `read` tool is **not** sandbox-confined (`tool-fs` hands the sandbox controller only to `applyWriteTool`/`applyEditTool`), so an absolute path is readable across workspaces — while a write back into another workspace is fenced.

## Decision

**The pad is a workspace directory of plain markdown documents, and the plugin is a list plus a writing surface over it.** `<workspace>/灵感画布/` holds `文章/<title>.md` and `卡片/<title>.md` — the sub-directory *is* the kind, the file name *is* the title. A visible Chinese directory name is deliberate: the operator is a writer, not an engineer, and a hidden `.dsh/` path reads to them as "my file is gone".

`<workspace>/灵感画布/.index.json` carries `{ order, archivedIds }` — the same two facts the official workspace registry keeps as `workspaceIds` + `archivedSessionIds`. A missing or corrupt index degrades to name order with nothing archived; it never makes the pad unopenable. Note that `ctx.fs` reports no mtime, so the index — not a timestamp — is what orders the pad.

The host half is `CanvasService` (core) plus `CanvasRemoteService` (a Typert Remote under the `canvas` namespace) exposing `list` / `read` / `create` / `write` / `setArchived`. Calls are plain JSON with an absolute workspace root and a pad-relative name, and take no session lookup — the `local-files` convention. Every mutation goes through the mounted `ctx.fs`.

**Archiving replaces deletion.** `setArchived` toggles membership in `archivedIds` and never touches the file, which is the official session-archive semantics ("hide from grouping surfaces") and the only shape that stays inside the host's seams.

The browser half mounts the Remote, registers a page-type `sidebar.right.pane.tab` with a `guide` capsule (the official registry then enters it directly when it is a pane's only type), and renders the list beside an edit / preview / split surface.

**Three editor invariants, each load-bearing.** The `<textarea>` is uncontrolled and keyed by a load token, so nothing ever writes its `value` back and the caret cannot jump on save; composition is a hard stop for both the save and the preview, so an IME candidate window is never torn down mid-word; and the wrapper around the textarea does not scroll, so there is exactly one scroll container (two nested scrollers was the first prototype's visible bug).

**Pasting a table converts it.** `paste-table.ts` tries the `<table>` inside `text/html` first, then tab-separated plain text, and declines anything ambiguous so ordinary prose is pasted untouched. Only the table is extracted, never the surrounding document. Insertion uses `document.execCommand('insertText')` because assigning `value` would clear the browser's native undo stack. An explicit selection-based action covers space-aligned tables, which no heuristic can safely claim.

**Copy yields the absolute path; the status line shows the relative one.** The operator references a draft from another session, often in another workspace, where a relative path does not resolve; the relative spelling is what stays legible on screen.

v1 registers **no model-facing tool and injects nothing** into the prompt: the contract is that the operator copies the path by hand.

## Alternatives considered

**One `cards.md` bundle rather than one file per item.** A single append-only inspiration stream would be vim- and grep-friendly, and would need no per-item addressing. It lost because referencing one card then requires a markdown block parser, and a card could not be diffed, versioned, or read independently — the host's guarded-write and diff machinery is per file, and the pad wants to inherit it rather than re-derive it.

**Rich text (Lexical) rather than a markdown textarea.** The official composer already depends on Lexical, so the stack is proven in this client. It lost because the pad's originals are the operator's plain markdown files: rich text either abandons that or pays a dom↔md conversion on every load and save, and the conversion loss is exactly what "the file is the source of truth" cannot afford.

**A hidden `.dsh/canvas/` directory rather than a visible Chinese one.** Hidden keeps the workspace tidy and dodges the `git status` quoting noise. It lost to the target user: a writer who cannot find their own drafts is worse served than a repository that shows a quoted path, and the drafts are meant to be opened in other programs.

**Deleting via `node:fs` (optionally with a manual `ctx.sandboxPolicy.resolve` check).** This was designed in detail — ask the policy service for the resolved mode, refuse on `read-only`, verify containment with `ctx.fs.contains`, then unlink — and would have given a real delete. It lost because it reconstructs a security boundary the host draws elsewhere and would still succeed under a read-only deployment; and because archiving, which the host already models for sessions, is what the writing case actually wants (recoverable, and the file is the operator's own).

**Reading through the official `workspaceFiles` Remote to avoid our own read path.** It would have saved a method. It lost because that API pages text with a line cap and returns bytes as base64 for whole files: the typert chain is required regardless (the write method needs it), so the only thing gained would have been an adapter layer.

**Relative paths on the clipboard.** Chosen first for legibility, then reversed: the point of the copy gesture is handing a draft to a session that may live in a different workspace, where a relative path resolves to nothing.

**A global "new inspiration" in `sidebar.footer.action`.** This is the official root-scope action seat and would be reachable from any surface. It lost because the action creates *a pad item*, which belongs to the list it appears in — and the list's own header is where a writer looks for it. The seat stays available if a genuinely global entry is wanted later.

**`turndown` + `@joplin/turndown-plugin-gfm` for HTML pasting.** The ecosystem already ships this pair (in the host's `web/tool-web`). It lost because whole-document conversion of a spreadsheet's clipboard HTML drags in the entire sheet and its styling; extracting the `<table>` alone is both smaller and more accurate, and richer elements (headings, bold) were explicitly out of v1 scope.

## Consequences

The pad inherits the host's write guarantees for free: atomic writes, recursive directory creation, sandbox fencing, and `FS_STALE_VERSION` on a stale write — the last of which is what stops a draft edited elsewhere from being silently overwritten.

The costs are equally real. **There is no delete**, so removing a draft for good means the operator's file manager — an honest consequence of the host having no such seam, recorded in the package README rather than papered over. **Externally edited files are never announced**: `workspaceFiles.changes` reports instrumented filesystem operations and does not watch the OS, so the version guard is the only discovery path. **Cross-workspace reference is read-only** — the model can read workspace A's draft from workspace B but cannot write it back. **The list order is index-owned**, because `ctx.fs` exposes no mtime, so a file dropped into the pad from outside sorts by name rather than by recency. **Merged HTML table cells degrade** to text plus empty slots.

`packages/canvas` is the first novel-domain plugin, which is what the `dsh-novel` meta-pack and the mode-switcher proposal's writing preset were waiting on. It provides a service, so it does not qualify for that proposal's session-plugin split; the intended integration is the global-plus-self-hide route its M2 owns.

The package's own suite is 53 tests over the pure vocabulary, the service core against an in-memory `ctx.fs`, and the clipboard converters; the repository's independence, hygiene, package-map and build-script checks are green. `pnpm gate` currently stops on a pre-existing red in `packages/datasets` (`tests/worktree.spec.ts`, the cross-process managed-worktree case), which reproduces unchanged on `main` and is unrelated to this package.
