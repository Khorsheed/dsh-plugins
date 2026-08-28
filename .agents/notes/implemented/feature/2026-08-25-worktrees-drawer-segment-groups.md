# Agent Note: worktrees drawer splits change segments and labels untracked files

Status: implemented

English | [中文](2026-08-25-worktrees-drawer-segment-groups.zh.md)

## Problem

The changes (改动) tab merged the uncommitted (vs HEAD) and committed (base..HEAD) file lists into one flat `all-changes` group, so a session could not tell which pending changes were uncommitted versus already committed onto the branch. An untracked (new) file surfaced in that same list but opened with no diff view (git has no diff for a new file), which read as a bug rather than a new-file preview.

## Decision

In the changes drawer, split the file tree into two groups — 未提交 (uncommitted) and 已提交 (committed) — and render each segment's group header with its count. The repository-browse group keeps no header (the tree title already names it). For an untracked file, the detail pane now shows a quiet caption (未跟踪的新文件 — 无 diff, 仅内容) above the CodeBlock, so "no diff" reads as intentional. `FileTree` gained optional group-title rendering for the segment header.

## Verification

`drawer.client.spec.tsx` still passes; 32 package tests and `pnpm run build` green; translation pairing in sync (the new `detail.untrackedNote` key is in both locales).

## Alternatives considered

- **Show only uncommitted.** Removes committed files from the changes view; a separate commits tab already surfaces the branch log, but the committed-file diff is useful here — splitting retains both.
- **`-z`/untracked state on the row alone.** The `??` badge already exists; the caption is the clearer signal for the no-diff case.

## Consequences

The changes tree now reads 未提交 / 已提交 explicitly; a new file's content is presented as an untracked-file preview rather than an empty diff. No data model change — this is presentation only.
