# @khorsheed/dsh-library

The library and learning engine: project-organized deep reading — book ingestion (EPUB/Markdown), a locked→current→done roadmap per book, a vocab book with Leitner mastery and photo provenance, evidence-gated quizzes and verdict-led unlocking.

## Features

- **The Library tab** (a page-type right-Sidebar tab, kind `library`): the project wall (two-column cards with progress bars and a due-review section) → the project view (a self-fitting shelf grid — cover, author, chapter progress, a dashed add-book card — plus the EPUB/MD drop zone) → the book view (the roadmap as a left-rail timeline with quiz-gated nodes beside skim-only read nodes a 「读完」 gesture completes, and the activity feed at the bottom) → the vocab book (entries with mastery boxes, the due mark and provenance).
- **Ingestion in the browser half**: EPUB is unzipped with fflate, read through DOMParser (OPF spine / NCX|NAV), and whitelist-sanitized; Markdown splits on its heading hierarchy. Failures are honest classes (not a zip / not an EPUB / DRM / no reading order / nothing readable). PDF is not supported (a renderer, not a structure extractor — the reader D2 conclusion).
- **The model face** (the `./tool` composition entry, granted per session by presets): `library_read` (projects/books/toc/chapter/roadmap/vocab/due/quiz/stats), `library_write` (project/book/roadmap/notes/quiz — a split classifies chapters (content → quiz nodes, front matter/prefaces/appendices → read nodes); every quiz question must carry a `ch:<n>` chapterRef inside a quiz node's ranges plus verbatim evidence, refused with a teaching error otherwise), `library_assess` (verdicts ledger → Leitner box moves → node quiz stats → pass-ratio unlocks). The shipped `library` skill carries every what's payload shape with examples. Every project keeps an append-only `events.jsonl` audit trail (shelving / splits / notes / quizzes / gradings / unlocks).
- **Self-hiding**: the tab type registers on the canvas double-check criterion (the profile's root rows ∪ the current session's preset rows naming `@khorsheed/dsh-library/tool`), fail-open on every unreadable path.

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

Details live in the package.json `dsh.compat.notes`: state is plain `node:fs` under `$DSH_HOME/state/dsh-library` (atomic writes + a per-project lock + append-only JSONL), never `ctx.fs` (the session sandbox refuses it); photo readback goes through the probed `attachments` service and degrades to the `unavailable` error code; `readAttachmentBase64` is whitelisted to attachment ids a vocab entry actually records.

## Known limits

- Not in v0.1: an in-conversation 「精读」tab, interactive quiz cards (quizzing runs in the conversation flow), PDF, on-device iOS acceptance, datasets/mission integration.
- Chapter bodies page under a 100KB budget; a book lands in one Remote call (its chapters are already parsed in the browser).
- Photo readback requires the entry to carry the full attachment reference (attachmentId + mediaType + bytes + width + height — the model copies it off the message's image block), else `ref-incomplete`.

## Development

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```
