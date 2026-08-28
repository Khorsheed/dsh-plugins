# Agent Note: local-files browser splits out of worktrees into a standalone plugin + 工作区 tab

Status: implemented

English | [中文](2026-08-28-local-files-standalone-plugin.zh.md)

This note records the decision to split the **local-files browser** out of `@khorsheed/dsh-worktrees` into a new standalone package, `@khorsheed/dsh-local-files`. It goes with the [local-files-browser proposal](../../../../proposals/active/2026-08-26-local-files-browser.md), which originally planned to keep the browser inside worktrees; the user later chose a different shape.

## Problem

The earlier iteration had shipped the local-files browser **inside** the worktrees plugin: the session-header badge's left capsule (folder icon) opened a `worktrees-local-files` overlay that browsed arbitrary local paths. That worked, but it mixed two semantically distinct capabilities into one package:

- **worktrees = git facts**: branch, ahead/behind, diff counts, commits, repo-relative files.
- **local-files = filesystem browsing**: arbitrary absolute paths, untracked/ignored/git-external files, pure content preview.

The repo convention is "one package = one capability" (`@khorsheed/dsh-*`), and the worktrees package had grown to host both. Separately, the user wanted the browser's content-preview implementations (HTML/Markdown/JSON/CSV/image) to be shareable with file-preview — that only happens cleanly when the code lives in its own package rather than buried inside the git plugin.

## Decision

**1. local-files becomes its own package, `@khorsheed/dsh-local-files`.** A new host data plane plus a client workspace tab:

- **Host**: `LocalFilesService` (`listLocalDirectory` / `readLocalFile` / `readLocalImage`) and a `LocalFilesRemoteService` exposing them as pure `@Remote` methods under a new `localFiles` typert namespace — **global, no agent param** (sessionless filesystem calls, mirroring the file-preview data plane). Path validation is `assertSafeLocalPath` (absolute only, no `..` traversal) — the file-preview trust model (the user's own machine), read-only.
- **Client**: a `conversation.view` list entry `id: local-files`, order 25, parallel to chat and 产物. The view is a left lazy file tree + right `DetailPane`/`ImagePreview`.

**2. The browser surfaces as a 工作区 (Workspace) tab, not a badge capsule.** The user's final shape is a **separate tab parallel to the 产物 tab** (file-preview), not a header capsule. The badge stays pure git (branch + counts); the browser lives in the view ring. The user was explicit that local-files must stay a *clean independent plugin*, not be merged into file-preview, because the semantics differ: file-preview = current session's products; local-files = browse any local directory.

**3. worktrees is stripped back to pure git.** Deleted `LocalFilesDrawer.tsx`, `store-local.ts`, `local-root.ts`; removed the local-file methods from `service.ts`/`remote.ts` (keeping git's `readRepoImage`/`LocalImageResult`); the badge lost its folder-capsule; `panel-service.ts` lost `attachLocalFiles`/`#localFiles`; and the obsolete local-files tests moved to the new package.

**4. Content-preview components are copied, not yet shared.** `language.ts`, `html-src-doc.ts`, `structured.tsx`, `HtmlPreview`, `ImagePreview`, `FileTree`, `DetailPane` were migrated into local-files and made git-agnostic (removed the changed-file/diff/detail-view machinery). A shared-preview-layer extraction is a possible future optimization but was deliberately out of scope for this batch — each package stays self-contained with no cross-plugin dependency (the repo's default).

**5. No in-session workspace switcher.** dsh binds a session's cwd at creation and it cannot be changed later (`SessionCwdConflict`); `insertSessionBefore` only re-groups accounting, it does not move cwd. So a "switch workspace" button is impossible without host changes, which the user accepted ("先不提供切换按钮"). The 工作区 tab therefore opens the current session's workspace content and 产物 files only; per-session root memory (`dsh-local-files-root:<sessionId>`) keeps each session on its own last-browsed root.

## Alternatives considered

- **Keep it inside worktrees (the shipped earlier iteration).** Rejected: it violated one-package-one-capability, and worktrees is a git plugin — a filesystem browser there was a semantic mismatch the user wanted corrected.
- **Merge into file-preview as the 产物 tab.** Rejected by the user: file-preview is the session's products; local-files browses arbitrary directories. Different semantics, so two independent packages.
- **Extract a shared preview layer now.** Deferred: it adds a new cross-package contract and dependency while the immediate goal was the split. Content components are duplicated (self-contained) and can be factored later.

## Consequences

- `pnpm check:plugins` stays 0 findings; `check:hygiene` and `verify-translation-pairing` pass; the new package builds both `lib/index.js` and `lib/client.js` via the shared `clientBundle` tsdown preset.
- The local-files tests now live in `packages/local-files/tests/service.spec.ts` (they were removed from worktrees, whose service no longer has the methods).
- The composed profile must load **both** `@khorsheed/dsh-local-files` (the 工作区 tab) and the stripped worktrees (the git badge) for the full experience; worktrees alone is now git-only.
- Deployment: the currently-live worktrees-embedded local-files browser on 3080 is replaced by this split.
