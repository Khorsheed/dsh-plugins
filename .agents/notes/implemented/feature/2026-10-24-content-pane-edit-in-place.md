# Agent Note: Edit in place in the shared content pane

Status: implemented

## Problem

The file surfaces (local-files, file-preview, worktrees) render a file through the shared content pane, but every change, even a typo in a README, has to go through the agent. A round trip through the model is slow for edits the user can see and type themselves while reading.

## Decision

The pane edits; each surface writes.

- **Kernel (`ui-content-preview`)**: `ContentPaneProps.onSave(request) => Promise<SaveOutcome>` is optional. When a surface supplies it, a complete (non-truncated) text read gains a header "Edit" action. In edit mode the source face (or a plain code file's only face) becomes a `<textarea>`, the rendered face shows the draft, and an edit bar carries the state plus Save / Discard (⌘S / Ctrl+S saves). `SaveRequest` is `{ content, base }`: `base` is the read content the edit started from, pinned at edit entry (`edit.ts`), so a reload mid-edit never moves the conflict anchor. `base: null` is the conflict bar's "Overwrite anyway". `SaveOutcome` is `ok` or `conflict | unsupported | missing | error`. The pane folds CRLF to LF for the textarea and restores CRLF on save. Drafts are remembered per (session, path) at module level like scroll offsets, so a file switch neither drops nor leaks one, and a dirty draft arms `beforeunload`. The header's inline order is edit, copy path (the most used gesture, beside edit), reload, show in folder; opening in an IDE always lives in the ⋯ menu, one named row per resolved IDE. That fits the 4-icon header budget with or without edit, so no gesture moves when a file becomes editable.
- **Surfaces**: each adds its own write Remote and passes `onSave` only when `browserOnHost()` holds (decided 2026-10-24: phones through the tunnel read only for now).
  - `localFiles/writeFile` and `worktrees/writeFile` (repo-relative, working tree only; commit content stays read-only) use `node:fs` directly, matching their reads. They write only an existing regular file within the read cap whose bytes round-trip UTF-8 losslessly. They compare the current content with `base`, then write a sibling temp file, `chmod` it to the original mode, and `rename` it over the realpath target.
  - `filePreview/write` goes through `ctx.fs` like its reads: a lossless strict-UTF-8 read, a `base` compare, then `writeText(..., { kind: 'replaceIfVersion', version })` with the version that `stat` returned. `FS_STALE_VERSION` maps to `conflict`. A sandboxing backend fences the write as it does the agent's. A leading BOM, which the read's decoder strips, is restored.
  - After a successful write the surface re-reads before resolving, so the pane leaves edit mode on the content actually on disk. worktrees also ticks `refresh` so the change list picks up the edit.

## Alternatives considered

**A rich editor (CodeMirror 6 / Monaco).** It loses for the first version: the kernel is inlined into three client bundles, and the reading-time edits this targets are short. A textarea keeps bundle size flat and works with IMEs everywhere. CodeMirror stays the upgrade path, lazily loaded on entering edit mode.

**WYSIWYG markdown (tiptap / milkdown).** Rejected: the documents carry raw HTML (`<img …>` in READMEs), and a parse/serialize round trip rewrites formatting the user never touched.

**One shared host-side write helper.** Not possible today: the only private shared packages are client source-plane packages, and a host import of one would be missing in a tarball install. The write core is small and duplicated in local-files and worktrees. file-preview uses `ctx.fs` instead.

**A version token on the read wire (mtime/hash).** Not needed: sending `base` (≤ the read cap) lets each server compare the content it actually reads, leaves all three read payloads unchanged, and ignores mtime-only touches. file-preview additionally closes the compare→write window with the fs face's own version guard.

**Enforcing host-only on the server.** The Remotes trust whoever can reach the instance, exactly like the existing reads of arbitrary absolute paths. The host-only rule is a client gesture gate, not a security boundary.

## Consequences

- The user can fix a document while reading it, and the edit cannot silently overwrite an agent write that landed meanwhile. The agent side is protected too: the host's read-before-edit policy rejects the agent's next edit of a user-modified file and asks it to re-read.
- local-files and worktrees still have a tiny compare→rename race (no OS-level conditional write). Acceptable for one user on one machine.
- Non-UTF-8 files, files over the read cap and images are read-only. Tab inserts nothing (keyboard focus moves as usual). There is no new-file creation.
- `scripts/sync-icon-artwork.mts` currently fails against the harness checkout (the upstream icon module gained shapes it cannot parse, and some packages import icons upstream removed). `IconEditOutlineMedium` was added to the kernel's `icons.tsx` in the generator's exact output form, so a regeneration reproduces it.
