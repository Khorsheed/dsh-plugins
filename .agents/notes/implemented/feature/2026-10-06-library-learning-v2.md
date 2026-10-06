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

## The sidebar

The browser half is one route stack (`client/store.ts`) over today → project → book → node → cards → quiz → result → review, built on `ui-panel-kit` (`PanelRoot`, `PanelHeader`, `UnderlineTabs`, `ChipRow`, `ListRow`) so one layout serves a desktop sidebar and a phone's full-screen panel (docs/panel-design.md; `pnpm check:panels` clean). Views read the host through a small `useLoad` hook keyed on the store's `rev`. The pane never does the model's work: adding a book, (re)planning, composing a quiz and judging open answers are drafted into the bound session's input (`primeConversation`) after `bindTarget`. Choice and fill-in answers are judged in the pane (`client/judge.ts`); a sitting without open answers is ledgered straight through `putAttempt` with `by: 'self'`, otherwise the whole sitting goes to the coach so it is one attempt. A sample page (`examples/sidebar`, port 8877, in-memory data) drives screenshots.

## Live trial (2026-10-06, deepseek-flash, a throwaway instance on 0.2.0-rc.2)

- The learning session's model sees exactly ask_user_question, library_read / library_write / library_assess, web_search and web_fetch; `list_capabilities` is masked and the three blanked root sections are gone (a 3.3k-character system prompt); the `library:binding` context line arrives each turn.
- Adding PNS 6e and drafting a path took one turn. Two shapes the model wrote broke the store and are now absorbed: a node's goals as a bare string (kept as a one-item list), and part headings as contents rows (a row that only repeats its part is dropped).
- The model sees an image block's id without its `sha256:` prefix and without `bytes`, so a page's photo reference it copies cannot be read back. `src/image-refs.ts` remembers each session's image references from committed `session/event`s and the page write resolves from them (the id, or nothing for the latest photo).
- One page photo, two runs: about two thirds of the underlines carded each time, with different misses; in-context glosses were right. The sidebar therefore needs an add-a-missed-word path.
- A five-question chapter quiz came out on the two axes first try: three marked-card questions and two content questions, all on photo evidence.
- A quiz scoped to a still-locked node is stored with a warning.

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
- Photos still go through the conversation until the sidebar camera lands (M2c); the record toast and the header bind chip are M3.

## Testing

`tests/store.spec.ts` (documents, drafts, tolerant ledgers, bindings, locks), `tests/service.spec.ts` (key folding, near/exact merge, pending + `mergeInto`/`asNew`, page carding, undo, review, both quiz axes, the material-book rule, the cascade with void and card-less misses, re-adoption keeping progress, binding summary), `tests/tool.spec.ts` (binding defaults and teaching errors, chat-card session refs, the rendered context), `tests/boot.spec.ts` (row wiring, quieting config, `tools: none`), `tests/judge.spec.ts` (the pane's choice / fill judging), and the bundle-learning patch spec; the sidebar screens were checked at 390px in both themes and at desktop width on the sample page.

## Related

- [M1 note](2026-10-06-library-learning-mode-m01.md) — the store, state machine and visibility criterion this keeps.
- Proposal `proposals/active/2026-10-06-library-learning-mode.md` (v2) and prototype `proposals/prototypes/library-learning-v2.html` (local, not tracked).
