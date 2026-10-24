# @khorsheed/dsh-library

English | [中文](README.md)

Study the books and courses at hand with a coach: books are registered, never uploaded; the coach drafts the path; photographed underlines become your own knowledge cards; missed questions are retaken until you get them.

Teaching yourself from a textbook used to mean planning your own pace, copying your own notes, writing your own questions — and nobody remembered to ask again what you got wrong. The library organizes learning by project ("Math", "Embodied AI"): you register the books you have, or let the coach pick an existing textbook; the coach drafts a study path that takes effect only when you press Adopt; while reading, a photo of a page turns its underlines and margin notes into knowledge cards; each station ends with a chapter quiz, missed questions wait in 待订正 (to retake), and once you retake them right, that knowledge point turns from weak to mastered.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-today.png" width="640" alt="The right sidebar's Library, Today page: continue, review today (retakes and due cards), the project list, recent changes">

## Features

- **Register books and textbooks**: a book is registered by title, edition, ISBN and contents; the coach verifies the edition and its contents on the web (with source links) — nothing is uploaded, no file is parsed. Anything with a contents is a textbook: your own book, an existing book or digital course the coach picks, or an outline the coach writes; a project can hold several, numbered in study order and reorderable.
- **Adopt a study path**: each textbook has one path, drafted by the coach; in the sidebar you adopt it as this book's path or discard it; a new draft replaces the old one, and re-adopting keeps the progress already made. The path holds only levels, with overview chapters as optional side stops, and the chapters this path skips are listed apart.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-roadmap.png" width="640" alt="A textbook's page: the S-shaped study path with each station's progress, the chapters this path skips below">

- **Photograph underlines and margin notes**: take a photo of a page from the sidebar and the coach reads its printed text and every underline and note at once: certain marks become cards in one go, uncertain ones are listed apart. Knowledge cards can be filtered by source, searched, marked mastered or deleted; the same word or concept merges instead of making a second card. When the coach notes a weak point, the sidebar toasts it with an undo.
- **Chapter quizzes**: each station ends with a quiz. Questions are chosen on two axes: what they target (what I marked / what I asked / what I missed / the chapter's topic) × what they rest on (a quote from the photo / a web quote with its link / domain knowledge). Choice and fill-in are judged on the spot, open answers go to the coach; a question you flag as faulty is voided and never counts.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-quiz.png" width="640" alt="A station's chapter quiz: choice and fill-in judged on the spot, an open question marked as handed to the coach">

- **Retakes and point mastery**: each station lists its knowledge points. A missed question waits in that station's 待订正; retakes never count toward passing; a question answered right leaves the list, and its point moves accordingly: weak (open misses, or not yet answered right since the coach's note) → practicing → mastered (no open misses, at least 3 different questions right across 2 attempts), with the evidence one click away. A station at its pass mark unlocks the next.
- **Review today**: the Today page gathers every station's misses into one retake paper, plus the cards due. Review means answering: fill the sentence, pick the meaning here, spell, explain a concept; a round ends with a summary and a "practice the missed" round, and the flashcard mode stays. Recent changes lists which points just turned weak or mastered.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-points.png" width="640" alt="A station's knowledge points in weak, practicing and mastered states, with the to-retake entry above">

- **The session follows the book**: a session binds to a project or one of its books, and a chip in the session header shows and switches the binding; what needs the model (adding a book, planning, composing a quiz, judging open answers) is drafted into the composer by the sidebar for you to send.
- **Works on a phone**: one layout that adapts to its width, full screen on a phone. Projects have a color and an icon, books a generated cover.

## Install

Recommended: the learning suite, together with the basic experience:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```

Restart the instance, then pick 学习模式 (learning mode) in the session's mode picker: the coach persona plus the library's model tools.

Advanced: this package alone.

```sh
dsh plugin --profile web add @khorsheed/dsh-library
```

Installed alone, only the host service and the data face are there and **there are no model tools** (they are granted per session by the `preset-dsh-learning` row declared in `@khorsheed/dsh-learning-suite`); the Library sidebar self-hides per session and appears only where the library tools are reachable (hidden in standard mode). So a standalone install needs a mode that grants `@khorsheed/dsh-library/tool`. Uninstalling removes every surface.

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

## Compatibility

| Host line | Verdict |
|---|---|
| npm release line (0.2.0-rc.x) | Full support (`minHost: 0.1.7-rc.1`: beyond the page-type right-Sidebar tab and the Remote face, no host API newer than that; preset granting needs 0.1.7-rc.1's `@deepseek-ai/dsh-agent-preset` row type — declared by the bundle package) |
| deepseek-harness master (the 0.2.1-rc.1 dev line) | Verified (`verifiedHost: 0.2.1-rc.1`) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes |

Details live in the package.json `dsh.compat.notes`: state is plain `node:fs` under `$DSH_HOME/state/dsh-library` (atomic writes + a per-project lock + append-only JSONL), never `ctx.fs` (the session sandbox refuses it); photos are saved and read back through the probed `attachments` service, degrading to the `unavailable` error code.

## Known limits

- **No book uploads**: book files are not uploaded or parsed (EPUB / PDF).
- **Photos go through the conversation**: the sidebar's photo button sends the photo as your message in the conversation, where the coach reads it.
- **Not yet**: an in-conversation 「精读」 tab, XP and streaks, project-level exams and cross-book linking.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The sidebar.** Navigation of the page-type right-Sidebar tab (kind `library`): today → project (continue, drafts waiting, textbooks numbered in study order with their progress, links; deleting a project or a textbook asks through a dialog that spells out what goes) → textbook (a roadmap draft or the S-shaped path, plus the chapters the path skips; how-to-use pages, answer keys and appendices in the book's before-you-start / appendix strip) → node (guide / my notes / chapter quiz) → knowledge cards → chapter quiz → result → review. The tab type self-hides on the canvas double-check criterion (root rows ∪ the current session's preset rows naming `@khorsheed/dsh-library/tool`), fail-open on every unreadable path.

**Books and textbooks.** A book IS a resource (`library_resource` with `kind: "book"` and a contents); a book is a knowledge or a material book, and a material book takes no content question from memory. Textbooks are numbered in study order (`seq`). The project carries no path; every path belongs to a textbook.

**Roadmaps.** Adoption keeps the progress of nodes whose ids survive. Nodes are quiz (a chapter quiz completes them), acceptance (judged line by line) or read (「读完」 does); a station points at its textbook's chapters, and a side link or coached teaching never moves the path.

**Photo pages.** One page photo records its printed text and every mark at once; photos are kept by attachment reference, and reading one back is whitelisted to pages the project recorded. A photo page needs the full attachment reference (attachmentId + mediaType + bytes + width + height — copied verbatim off the message's image block), else `ref-incomplete`.

**Knowledge cards** dedupe on the write path: an exact normalized key (case, width, punctuation, English plurals) merges; a near-duplicate is held back with candidates for the coach to `mergeInto` / `asNew`. Weakness (0–3) is kept apart from the review schedule (Leitner); a card hangs on a book or on the project; a recording can be undone.

**The assess cascade** (`library_assess`). Void questions count for nothing; a passed card climbs a box and eases its weakness, a missed one comes back tomorrow and grows weaker; a card-less miss does not become a card (only a word or concept the coach names does) — it waits in the station's 待订正; point state changes are ledgered and feed Today's recent changes; a node at its pass ratio completes and unlocks what follows, and a retake never moves it.

**Session binding.** A session binds to a project or one of its books, and the tools' project / book default to it; every turn carries one bound-context line through `systemPrompt.context` (book, node, weakest cards).

**The model face** (the `./tool` composition entry, granted per session by presets): `library_read`, one `library_<noun>` tool per write (`library_project` / `library_resource` / `library_roadmap` / `library_notes` / `library_page` / `library_cards` / `library_quiz` / `library_binding`), `library_assess`, documented in their own descriptions; every refusal teaches the correct call. Optional `hideSections` / `denyTools` quiet unrelated root prompt sections and tools in that scope.

</details>

## Development

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/library`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
