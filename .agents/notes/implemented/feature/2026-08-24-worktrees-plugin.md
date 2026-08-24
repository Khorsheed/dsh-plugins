# Agent Note: the worktrees plugin — session badge + changes drawer over pure git facts

Status: implemented

English | [中文](2026-08-24-worktrees-plugin.zh.md)

## Problem

The repo's multi-worktree collaboration (docs/development.md: worktree → main → 3080) had no visible git status: a session's agent works in a worktree whose branch, ahead/behind, changed files, and commits were only reachable by hand-running git commands, and the human had no glanceable surface at all. The [worktree-governance proposal](../../../proposals/active/2026-08-23-worktree-governance.md) scoped v1 to "make git facts visible and well-presented" — no governance judgment (no global board, no violation panel, no model review, no gates) until the facts themselves are established.

## Decision

Ship one independent package `@khorsheed/dsh-worktrees` (host service + Typert Remote + client half, the datasets/mission single-package pattern):

- **Host** `ctx.worktrees` (`src/service.ts`): read-only git queries only, stateless, registry = `git worktree list` itself. Every UI datum has a named git source: badge total = `diff --numstat HEAD` + `diff --numstat <base>...HEAD`; file tree segments = `status --porcelain` (+ `ls-files -o` for untracked) and `diff --name-status <base>...HEAD`, counts merged from `--numstat`; repo browse = `ls-files -co --exclude-standard`; commit log = `log --format=... <base>..HEAD`; per-commit files = `show --name-status`; per-file diff = `diff <range> -- <path>` / `show <sha> -- <path>`. Client-supplied paths go through `assertSafePath` (rejects absolute/`..` traversal).
- **Remote** (`src/remote.ts`): wire namespace `worktrees`, methods resolve `agent.session.header.cwd` → repo toplevel → worktree entry. Registered in `scripts/gen-typert.mts`'s `TYPERT_PACKAGES` (the shared build script's per-package registration every typert package needs; no harness change).
- **Client** (`src/client/`): badge in `conversation.session.header.utilities` (the currently-empty right-aligned utilities slot — zero conflict), two click zones (repo → Repository mode, branch → Changes mode); drawer in `shell.overlay` (additive id `worktrees-drawer`, order 130 — coexists with ui-file-preview's drawer at 110), default collapsed; three modes (Changes with uncommitted/committed groups in one tree, Commits with inline commit-file trees, Repository full browse); detail pane with `Diff | Content` toggle (a custom `DiffView` that renders the actual unified diff but follows the official `DiffBlock` card anatomy — code-block surface, path header, `- `/`+ ` state-token prefixes, copy control, `└ +A -R · N file(s)` footer — plus the official `CodeBlock` for content; the official `DiffBlock` itself takes whole-file old/new sides, which misrepresents a patch); git action row (refresh / copy branch / open folder, the host gesture gated on loopback `canOpenPath`); tree defaults to the first level with expand-all/collapse-all.
- **Conventions honored**: identity triangle (cordis.patch.yml quoted name, tsdown `clientBundle(id)`, invariant `PACKAGE_NAME`), self-mounting (`dsh.bundle.patch` in `files`), `dsh.client` discovery, `zod` as a dependency (the generated remote-client imports it — missing it turns the browser bundle's require into a runtime throw), peerDependenciesMeta optional for client packages, bilingual READMEs with Compatibility, degrade-don't-explode (non-repo session → badge hidden; missing local `<base>` → committed segment skipped; detached HEAD → `detached` label).

## Alternatives considered

- **Full governance layer first** (global board, violation panel, model review, merge gates — the proposal's original scope): deferred to M3+ — rule engines cannot judge intent (is a dirty main legit mainline work or a violation?), and a board is useless until the facts it aggregates are trustworthy. v1 renders facts; the model-review direction is recorded in the proposal's 后续阶段.
- **Jump to ui-file-preview's tab for repo browsing**: its tab is artifact/deliverable browsing with no file tree — a full repo browse is new UI, so it became the drawer's third mode reusing the tree anatomy instead of duplicating an explorer.
- **Official DiffBlock for git patches**: it draws whole-file old/new sides (every old line deleted, every new line added) — a patch needs line-wise unified-diff rendering, hence the small `DiffView` using the same token vocabulary.

## Consequences

- Every session shows where it works (repo/worktree/branch + diff counts) with zero official-code changes; community install/uninstall works via `dsh plugin add/remove` (self-mounting), verified by `check:plugins` (0 findings) and `check:hygiene`.
- The badge and drawer are additive slot consumers; composing the plugin out removes every surface it adds.
- `scripts/gen-typert.mts` gained one registered package (mechanical, required for any typert package in this repo).
- 21 tests cover the parsers (worktree list, porcelain, name-status, numstat merge, log) and the service against a real temp git repo (ahead/behind/dirty, both segments, linked-worktree isMain, path safety).
