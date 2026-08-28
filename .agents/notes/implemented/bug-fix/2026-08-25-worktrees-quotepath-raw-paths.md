# Agent Note: worktrees render raw paths (git core.quotePath=false)

Status: implemented

English | [中文](2026-08-25-worktrees-quotepath-raw-paths.zh.md)

## Problem

Every path-producing git command in `packages/worktrees` (`git ls-files -co --exclude-standard` for the repo browse, `status --porcelain`, `diff --numstat`, `diff --name-status`, `show --name-status`) C-quotes paths that contain non-ASCII bytes (Chinese) or spaces, because `core.quotePath` defaults to true. A path like `algorithm/textbook/${…}/第一章.md` comes back as `"algorithm/.../\345\256\232...md"`.

The plugin's parsers split those outputs on newline/tab and never unquote. Splitting a quoted full path on `/` glues the leading `"` onto the first path segment, so the file tree rendered stray `"algorithm`, `"Writing`, `"Cognition_Learning` directory names and octal escapes. The same class of bug affects the changes (worktree) and per-commit file lists, not just the repo-browse tab.

## Decision

Make the `git()` helper in `src/git.ts` always run `git -c core.quotePath=false <subcommand>`. This is a host-side data-plane change: git now emits raw UTF-8 paths for every command, so the existing line/tab parsers keep working unchanged and the client renders the real names. Applied centrally rather than per-command so a future path-producing call cannot forget the flag.

## Verification

`tests/service.spec.ts` gains a non-ASCII case: a committed `笔记/第一章.md` appears in `repoFiles` and no returned path starts with `"`. 28 tests pass, `pnpm run build && pnpm run test` green. Manually confirmed against `~/code` (a container repo with 102 non-ASCII paths): `repoFiles` returns 1645 entries, 0 quoted, all raw UTF-8.

## Alternatives considered

- **`-z` NUL-delimited output.** Strictly more robust — it also survives paths containing tabs or newlines — but requires rewriting every path parser to NUL-split. Deferred; adopt only if such a path surfaces.
- **`-c core.quotePath=false` on the path-producing calls only.** Works but spreads the flag across many call sites; the central helper is the smaller, more consistent change.

## Consequences

Non-ASCII (and space-containing) paths now render as real names everywhere: repo browse, changes, and per-commit file lists. Untracked sibling git repos and scratch directories under a container repo root (e.g. `~/code`) still appear in the repo-browse list — a separate management concern, intentionally out of scope for this change.
