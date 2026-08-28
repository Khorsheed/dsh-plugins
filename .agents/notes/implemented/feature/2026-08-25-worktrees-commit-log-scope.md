# Agent Note: worktrees repo-wide commit log, untracked file counts, branch labels

Status: implemented

English | [中文](2026-08-25-worktrees-commit-log-scope.zh.md)

## Problem

The commit log tab showed only `base..HEAD` (the branch's commits ahead of main), so it emptied once a branch was merged/caught up. Untracked files opened with no `+/-` counts (git has no diff vs HEAD for a new file) and no obvious "which branch" signal.

## Decision

- **Commit log = repository log**: `commitLog` now runs `git log --format=<...>%D --name-only -n 200 HEAD` — the checkout's whole history (kept populated after merge), capped at 200, with `%D` decorations parsed into a per-row `branches` label.
- **Untracked line counts**: in `changes`, untracked (`??`) files get `additions`/`deletions` from `git diff --no-index --numstat /dev/null <path>` (a new file's content is all additions; deletions 0). A failure-tolerant `gitAllowFailure` helper tolerates the exit-1 that `--no-index` returns on a difference. Bounded to 200 untracked files.
- The 已提交 (committed) segment is retained; it is the branch's file-level diff vs main, distinct from the commit log.
- **Commit body**: the commit detail fetches the message body (`git show --format=%b`) with the selected commit's files and renders it below the subject.

## Verification

`commitLog` on `~/code/dsh-plugins` returns 200 rows with `branches` (`HEAD -> main, origin/main`); untracked `room-redesign-card.html` reports `+466 −0`. `git.spec`/`service.spec` updated for the new field and scope; 32 tests pass, build green, translation pairing in sync (new `commits.recent` key bilingual).

## Alternatives considered

- **`git log --all`.** Broader, but harder to scope + label; the checkout's own HEAD history is the natural "repository record".
- **Drop the committed segment.** Loses the branch's file diff; kept since it is distinct from the commit log.

## Consequences

The commit log no longer empties after a merge, each row shows its branch/tag, and untracked files show their added-line count. Presentation + data-plane only.
