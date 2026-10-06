# Agent Note: novel_write never overwrites an existing chapter body without `replace`

Status: implemented

## Problem

On 3080 the user imported a manuscript that was already in the workspace (`梦境守护者/第1章.md`, about 25,000 characters). The skill says to register such a file with `novel_write(chapter, title, byUser=true)` and **no** `content`. The model passed `content` anyway, as a description: 「（内容见工作区 梦境守护者/第1章.md — 用户原稿整理落盘…）」.

`writeChapter` wrote that line over the file. It stats the file and replaces it under the fresh version, so nothing stopped the overwrite. The chapter page then correctly previewed a single line. The original was recovered from the session record by hand.

## Decision

- **A body is never overwritten implicitly.** When the target file already holds a non-empty body, `content` is refused with the new `NovelError` `'body-exists'` unless the request sets `replace: true`. The check runs before the write and before registration, so a refused call leaves both the file and the chapter table untouched.
- **The tool:**
  - `novel_write` gains a `replace` param.
  - The refusal names the existing length.
  - It says to drop `content` when only registering, or to `novel_read` the chapter first and rewrite it in full with `replace=true`.
- **The skill:**
  - The import line now says `content` becomes the whole file, not a note.
  - The first iron rule says a revision that replaces a whole chapter reads the original first and passes `replace=true`.
- **The client:** the client error locale gains `error.body-exists`.

## Alternatives considered

- **Detect placeholder-looking content** (short text, 「见工作区」). Rejected: a heuristic. The real invariant is "registering never destroys text".
- **Keep a backup copy on every replace.** Rejected: an explicit `replace` after reading is a deliberate edit, and the host's file history is the place for undo.

## Consequences

- A model revising its own draft now needs `replace=true`. It is one extra parameter, and the refusal message says exactly that.
- Tests:
  - `store.spec` has a new case: refusal, untouched file and table, register-only, then an explicit replace.
  - The 用户原稿 re-draft case now passes `replace: true`.
