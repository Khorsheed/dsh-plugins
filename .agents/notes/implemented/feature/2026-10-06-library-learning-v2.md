# Agent Note: library v2 — registered books, knowledge cards and two-axis quizzes

Status: implemented

## Problem

The M1 library ([M1 note](2026-10-06-library-learning-mode-m01.md)) assumed the learner uploads a book's text (EPUB/Markdown) and that quizzes grade against chapter bodies. Walking the journey with the user against catmem's learning mode and a real photo (an IELTS page with underlines and margin glosses) changed the premise: learners mostly read paper books, most books are known to the model or findable on the web, and what the learner wants quizzed is what *they* marked, asked about, or got wrong. The data model had no place for any of that, and parsing uploads was cost with no buyer.

## Decision

`@khorsheed/dsh-library` keeps its package identity, store discipline (per-project lock, temp+rename, append-only ledgers, plain `node:fs`), state machine and assess cascade; the domain around them changes (schema `LIBRARY_STATE_VERSION` 2 — v1 was never deployed, a v1 root reads as empty):

- **Books are registered, never uploaded** (`putBook`): title, edition, ISBN, `bookKind` (`knowledge` | `material`), a table of contents and its source (`web` needs the url). EPUB/Markdown ingestion, sanitize, `chapters/*.html`, `library_read · chapter` and fflate are gone.
- **Roadmaps are per book and drafted**: the coach writes `roadmap.draft.json` (states are not the coach's to set); the learner's 采用 (`adoptRoadmap`) makes it `roadmap.json`, starting roots `current` and keeping the state and quiz stats of nodes whose ids survive a re-split. Read nodes complete via `markNodeRead`.
- **Photo pages** (`recordPage`, `books/<id>/pages.jsonl`): one call records the page's printed text and every mark (`text`, `sentence`, `handNote`, `gloss`, `uncertain`) and cards every certain mark at once; uncertain marks stay on the page, uncarded. Photos are attachment references; `readPagePhoto` reads back only pages the project recorded; `savePhoto` stores a sidebar upload through `attachments.saveImage`.
- **Knowledge cards** (`cards.jsonl`, replacing the vocab book): `word` | `concept`, aliases, gloss beside the learner's own `userGloss`, stacked contexts and sources (`photo` | `chat` | `quiz` | `manual`), `weakness` 0–3 apart from the Leitner `mastery`, `bookId` optional (absent = project-level). **Dedupe lives on the write path** (`src/cards.ts`): an exact normalized key (NFKC, case, whitespace, surrounding punctuation, English plural fold; term and aliases) merges; a near match (containment of a substantial key, or ≥ 0.6 shared words / CJK characters) is held back in `pending` with up to three candidates, and the coach resends with `mergeInto` or `asNew`. Photo words merge near matches directly. A chat card starts at weakness 1; `weaken` adds one; `undoCards` deletes what a recording created and strips the source (and weakness) it stacked elsewhere. `reviewCard` moves only the schedule.
- **Two-axis quizzes**: each question carries `target` (`marked` | `asked` | `missed` need live `cardIds`; `topic` does not) and `evidence` (`photo` needs a recorded page and a quote — a quote absent from the page text is a warning; `web` needs url + quote; `knowledge`). A `material` book refuses a knowledge-backed `topic` question — content the model cannot recall.
- **The cascade** counts only non-void verdicts; a pass climbs a box and eases weakness, a miss resets to box 0 and adds weakness, a card-less miss creates a card (`missedCard` or the prompt), and the gated node completes at the pass ratio.
- **Session bindings** (`bindings.json`, session id → `{ projectId, bookId? }`): Remote `boundTarget` / `bindTarget` take the calling agent first (the canvas pattern); the tools default `project` / `book` to the binding and teach an unbound session to ask and bind.
- **The `./tool` row** registers the three tools (usage in their descriptions — the `library` skill is removed), the `tool:library` section, and a per-turn `library:binding` context (`systemPrompt.context`, rendered synchronously from `bindingSummary`: bound book, current node, weakest cards). Optional `hideSections` (scoped empty sections shadow root ones) and `denyTools` (`tools.restrict`) quiet a focused preset's scope; a name the composition lacks is logged, never fatal.

`@khorsheed/dsh-bundle-learning` is dieted to persona, ask-user, web, compaction and the library row with `hideSections: [harness:source, app:web-surface, ui:deliverable-file-references]` and `denyTools: [list_capabilities]`; fs, skills and todo are dropped.

The browser half is an interim project/progress list until the v2 sidebar lands (proposal M2b).

## Alternatives considered

- **Keep uploads as an optional path**: rejected by the user — it keeps the parsing problem alive for a minority path; a book the web cannot place is registered from a photo of its contents page instead.
- **Let the coach grep cards with host fs tools**: rejected — the state root is outside the workspace, grep cannot fold plurals or aliases, and a dedupe the model must remember to run is a dedupe that gets skipped. A `query` on `library_read · cards` is the search, and the write path is the guarantee.
- **Reject near-duplicates outright**: rejected — writes in a batch would all fail for one ambiguous card; holding only that card back (`pending`) keeps the rest and makes the decision explicit.
- **Async bound context with a cache**: rejected — the first turn of a session would see nothing; the store reads are small and synchronous, so the context renders directly.
- **A separate quieting plugin for the preset**: rejected for now — the library row is the only row the learning preset owns; two config arrays on it are less surface than a new package.

## Consequences

- The model can no longer quote a book it was never shown; photo and web evidence are the only verbatim sources, and the material-book rule prevents memory-backed content questions.
- Cards are one per thing per project, so a word met in two books carries both sentences — the review rotates them.
- `restrict` and scoped blank sections are verified only against fakes here; whether the preset row's ctx is scoped enough for `tools.restrict` is checked on a live instance (proposal probe P1-8). A failure there is a logged no-op.
- The sidebar shows less than M1 until M2b ships; nothing is deployed, so no user loses a view.

## Testing

`tests/store.spec.ts` (documents, drafts, tolerant ledgers, bindings, locks), `tests/service.spec.ts` (key folding, near/exact merge, pending + `mergeInto`/`asNew`, page carding, undo, review, both quiz axes, the material-book rule, the cascade with void and card-less misses, re-adoption keeping progress, binding summary), `tests/tool.spec.ts` (binding defaults and teaching errors, chat-card session refs, the rendered context), `tests/boot.spec.ts` (row wiring, quieting config, `tools: none`), and the bundle-learning patch spec.

## Related

- [M1 note](2026-10-06-library-learning-mode-m01.md) — the store, state machine and visibility criterion this keeps.
- Proposal `proposals/active/2026-10-06-library-learning-mode.md` (v2) and prototype `proposals/prototypes/library-learning-v2.html` (local, not tracked).
