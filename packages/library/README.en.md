# @khorsheed/dsh-library

The library and learning engine: project-organized close reading. Books are registered, never uploaded (the coach verifies the edition and its contents on the web); each book gets a roadmap the coach drafts and the learner adopts. Photographed underlines and margin notes become the learner's own knowledge cards (知识卡片); a subject project's mastery unit is each station's knowledge points — the coach's notes land on a point, missed questions wait in 待订正 to be retaken in the sidebar (never counted toward passing), and answered right again, a point turns from weak to mastered; chapter quizzes are composed on two axes (what they target × what they rest on), and graded verdicts move the roadmap forward.

## Features

- **The library sidebar** (a page-type right-Sidebar tab, kind `library`; one layout that adapts to its width, full screen on a phone): today (continue, reviews due, projects, recently noted) → project (continue, drafts waiting, textbooks numbered in study order with their progress, links; deleting a project or a textbook asks through a dialog that spells out what goes) → textbook (a roadmap draft to adopt as this textbook's path or discard, or the S-shaped path, plus the chapters the path skips) → node (guide / my notes / chapter quiz) → knowledge cards (filtered by source, searchable, mastered / delete) → chapter quiz (choice and fill judged on the spot, open answers handed to the coach) → result → review flashcards. What needs the model (adding a book, planning, composing a quiz, judging open answers) is drafted into the conversation input after the sidebar binds the session.
- **Registered books**: title, edition, ISBN, kind (knowledge / material) and the contents with its source url. No file is ever parsed.
- **Textbooks in study order**: anything with a contents is a textbook — the learner's own book, an existing book or digital course the coach picks, or an outline the coach writes itself — numbered in study order (`seq`) and reorderable. The project carries no path; every path belongs to a textbook.
- **Draft → adopt roadmaps**: the coach writes a textbook's draft (a new one replaces the old), the learner's 采用 in the sidebar makes it the path; adoption keeps the progress of nodes whose ids survive. Nodes are quiz (a chapter quiz completes them), acceptance (judged line by line) or read (「读完」 does); a station points at its textbook's chapters, and a side link or coached teaching never moves the path.
- **Photo pages**: one page photo records its printed text and every mark at once; certain marks become cards in one go, uncertain ones are listed apart. Photos are kept by attachment reference; reading one back is whitelisted to pages the project recorded.
- **Knowledge cards** dedupe on the write path: an exact normalized key (case, width, punctuation, English plurals) merges; a near-duplicate is held back with candidates for the coach to `mergeInto` / `asNew`. Weakness (0–3) is kept apart from the review schedule (Leitner); a card hangs on a book or on the project; a recording can be undone.
- **Two-axis quizzes**: target (marked / asked / missed / the chapter's topic) × evidence (a photo quote / a web quote with its url / domain knowledge). A material book takes no content question from memory.
- **The assess cascade**: void questions count for nothing; a passed card climbs a box and eases its weakness, a missed one comes back tomorrow and grows weaker; a card-less miss no longer becomes a card (only a word or concept the coach names does) — it waits in the station's 待订正; point state changes are ledgered and feed 今日's 「最近的变化」; a node at its pass ratio completes and unlocks what follows, and a retake never moves it.
- **Session binding**: a session binds to a project or one of its books, and the tools' project / book default to it; every turn carries one bound-context line (book, node, weakest cards).
- **The model face** (the `./tool` composition entry, granted per session by presets): `library_read`, one `library_<noun>` tool per write (`library_project` / `library_resource` / `library_roadmap` / `library_notes` / `library_page` / `library_cards` / `library_quiz` / `library_binding`), `library_assess`, documented in their own descriptions; every refusal teaches the correct call. A book IS a resource (`library_resource` with kind "book" and a contents). Optional `hideSections` / `denyTools` quiet unrelated root prompt sections and tools in that scope.
- **Self-hiding**: the tab type registers on the canvas double-check criterion, fail-open on every unreadable path.

## The workspace integration seam (server-side consumption)

Mounting this package on an **isolated Context with its own stateRoot** is a supported consumption form: the mounting side starts an independent instance with this package's `apply` + `config.stateRoot` on its own Context — state is bound per instance (`<stateRoot>/state.json`, `bindings.json`, `projects/<project id>/`); no service-core verb needs a session (a binding is keyed BY a session id — data, not a prerequisite).

```ts
import { apply } from '@khorsheed/dsh-library'

apply(isolatedCtx, {
  stateRoot: '/path/to/instance-state/library',
})
```

The mounting side's obligations and the semantics:

- **The `capabilities` verb is the display contract**: `remote.library.capabilities()` (host-side `service.capabilities()`) answers `{ protocolVersion: 1, hasStorage, storageUnavailableReason?, hasAttachments }` — storage writability with its reason (the store probe's own message) and the attachment probe's verdict at call time. Read-only display: enforcement stays at the write gates (`storage-unavailable` / `unavailable` refusals) exactly as before; the shape only grows, new fields always optional (the reader's evolution rule).
- **Attachments are probed per call**: the image routes (`savePhoto` / `readPagePhoto`) re-run `ctx.get('attachments')` on every call; mounted on a Context without an attachment store, those two routes degrade to an `unavailable` refusal — never a throw, everything else unchanged.
- **The state root is a deployment-local path**: the store is plain `node:fs` (atomic writes + per-project locks + append-only JSONL), deliberately never `ctx.fs` (the session-fenced sandbox). To keep state inside some synced / shared directory, point `stateRoot` at that path itself — the instance neither knows nor participates in any sync mechanism.
- **File locks genuinely coordinate across instances**: instances coexisting (or succeeding one another) on the same `stateRoot` serialize on `projects/<id>.lock`, `state.json.lock` and `bindings.json.lock` — one instance's write waits out the other's lock and lands after the release, never writes through.
- **Terminal dispose + same-root rebuild**: `dispose()` is idempotent and terminal, and fires automatically when the borrowed Context is torn down (wired through `ctx.effect` at construction) — afterwards every public verb, reads included, refuses with the coded package-named `LibraryDisposedError` (`code: 'disposed'`). A write racing disposal refuses coded before the lock is ever taken (the disk side was already safe: lock / temp write / atomic rename). Rebuilding over the same state root is legal: a new service instance on it works as usual, and everything the old instance wrote is there.
- **Local behavior unchanged**: apart from these additive surfaces, every semantic is byte-identical to before.

## Install

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
```

This package alone: the Library tab and the data face work; the model tools do not exist (they are granted per session by the `preset-learning` row declared in `@khorsheed/dsh-presets`). Uninstalling removes every surface.

## Compatibility

| Host line | Verdict |
|---|---|
| npm release line (0.2.0-rc.x) | Full support (`minHost: 0.1.7-rc.1`: beyond the page-type right-Sidebar tab and the Remote face, no host API newer than that; preset granting needs 0.1.7-rc.1's `@deepseek-ai/dsh-agent-preset` row type — declared by the bundle package) |
| deepseek-harness master (the 0.2.1-rc.1 dev line) | Verified (`verifiedHost: 0.2.1-rc.1`) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes |

Details live in the package.json `dsh.compat.notes`: state is plain `node:fs` under `$DSH_HOME/state/dsh-library` (atomic writes + a per-project lock + append-only JSONL), never `ctx.fs` (the session sandbox refuses it); photos are saved and read back through the probed `attachments` service, degrading to the `unavailable` error code.

## Known limits

- Out of scope: book file upload and parsing (EPUB / PDF), an in-conversation 「精读」tab, XP and streaks, project-level exams and cross-book linking.
- The sidebar's photo button sends the photo as your message in the conversation, where the coach reads it.
- The session-header chip shows and switches the project or book this session is bound to; when the coach notes a weak point the sidebar toasts it with an undo.
- Projects have a color and an icon, books a generated cover; the path holds only levels, with overview chapters as optional side stops and how-to-use pages, answer keys and appendices in the book's before-you-start / appendix strip.
- Review is answering: fill the sentence, pick the meaning here, spell, explain a concept; a round ends with a summary and a practice round for the missed; the flashcard mode stays.
- A photo page needs the full attachment reference (attachmentId + mediaType + bytes + width + height — copied verbatim off the message's image block), else `ref-incomplete`.

## Development

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```
