# @khorsheed/dsh-library

The library and learning engine: project-organized close reading. Books are registered, never uploaded (the coach verifies the edition and its contents on the web); each book gets a roadmap the coach drafts and the learner adopts. Photographed underlines and margin notes, the weak points a conversation reveals, and the questions the learner misses all become the learner's own knowledge cards (知识卡片); chapter quizzes are composed on two axes (what they target × what they rest on), and graded verdicts move the roadmap forward.

## Features

- **The Library tab** (a page-type right-Sidebar tab, kind `library`). The v2 sidebar (today / project / a book's path / the node / cards / chapter quiz / review) is in development; this version shows an interim view of projects and book progress.
- **Registered books**: title, edition, ISBN, kind (knowledge / material) and the contents with its source url. No file is ever parsed.
- **Draft → adopt roadmaps**: the coach writes drafts, the learner's 采用 in the sidebar makes one the path; adoption keeps the progress of nodes whose ids survive. Nodes are quiz (a chapter quiz completes them) or read (「读完」 does).
- **Photo pages**: one page photo records its printed text and every mark at once; certain marks become cards in one go, uncertain ones are listed apart. Photos are kept by attachment reference; reading one back is whitelisted to pages the project recorded.
- **Knowledge cards** dedupe on the write path: an exact normalized key (case, width, punctuation, English plurals) merges; a near-duplicate is held back with candidates for the coach to `mergeInto` / `asNew`. Weakness (0–3) is kept apart from the review schedule (Leitner); a card hangs on a book or on the project; a recording can be undone.
- **Two-axis quizzes**: target (marked / asked / missed / the chapter's topic) × evidence (a photo quote / a web quote with its url / domain knowledge). A material book takes no content question from memory.
- **The assess cascade**: void questions count for nothing; a passed card climbs a box and eases its weakness, a missed one comes back tomorrow and grows weaker, a card-less miss becomes a card; a node at its pass ratio completes and unlocks what follows.
- **Session binding**: a session binds to a project or one of its books, and the tools' project / book default to it; every turn carries one bound-context line (book, node, weakest cards).
- **The model face** (the `./tool` composition entry, granted per session by presets): `library_read`, `library_write`, `library_assess`, documented in their own descriptions; every refusal teaches the correct call. Optional `hideSections` / `denyTools` quiet unrelated root prompt sections and tools in that scope.
- **Self-hiding**: the tab type registers on the canvas double-check criterion, fail-open on every unreadable path.

## Install

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
```

This package alone: the Library tab and the data face work; the model tools do not exist (they are granted per session by the `preset-learning` row declared in `@khorsheed/dsh-bundle-learning`). Uninstalling removes every surface.

## Compatibility

| Host line | Verdict |
|---|---|
| npm release line (0.2.0-rc.x) | Full support (`minHost: 0.1.7-rc.1`: beyond the page-type right-Sidebar tab and the Remote face, no host API newer than that; preset granting needs 0.1.7-rc.1's `@deepseek-ai/dsh-agent-preset` row type — declared by the bundle package) |
| deepseek-harness master (the 0.2.0-rc.2 dev line) | Verified (`verifiedHost: 0.2.0-rc.2`) |

Details live in the package.json `dsh.compat.notes`: state is plain `node:fs` under `$DSH_HOME/state/dsh-library` (atomic writes + a per-project lock + append-only JSONL), never `ctx.fs` (the session sandbox refuses it); photos are saved and read back through the probed `attachments` service, degrading to the `unavailable` error code.

## Known limits

- Out of scope: book file upload and parsing (EPUB / PDF), an in-conversation 「精读」tab, XP and streaks, project-level exams and cross-book linking.
- The v2 sidebar, in-sidebar photo recognition and the session-header bind chip are in development (proposal M2b–M3).
- A photo page needs the full attachment reference (attachmentId + mediaType + bytes + width + height — copied verbatim off the message's image block), else `ref-incomplete`.

## Development

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```
