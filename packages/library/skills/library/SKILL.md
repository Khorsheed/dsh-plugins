---
name: library
description: How to use the library tools (library_read, library_write, library_assess) — every what's payload shape, the ch:<n> chapter convention, the evidence gate, and the assess cascade. Load before your first library_write.
---

# library — the learning memory's three verbs

The library stores learning projects: books (chapter bodies), a roadmap per book (locked → current → done nodes), a vocab book (flashcards + key points with Leitner mastery), and quizzes with graded attempts. Three tools cover it all: `library_read` (read-only), `library_write` (validate + persist), `library_assess` (the one cascading write). All ids come from reads — never invent one.

## Conventions that hold everywhere

- **chapterRef is `ch:<n>`** — `ch:3`, or `ch:3.2` for a section. The number is the book's 1-based chapter (the toc lists them). A ref that does not parse, or names a chapter the book does not have, is refused.
- **Errors teach.** A refused call answers with what was wrong and the correct shape — read it, fix the call, retry. Do not work around a refusal by renaming fields.
- **Read before you write.** The write verbs validate against what exists (the book's chapters, the roadmap's nodes); reading first (toc, roadmap, vocab) is how a write passes on the first try.

## library_read — `what` ∈ projects | books | toc | chapter | roadmap | vocab | due | quiz | stats

- `projects` — every project: `{ id, name, domain?, books, vocabCount, dueCount, roadmap?: { done, total }, current?: { bookTitle, nodeTitle } }`. No arguments.
- `books` — one project's books: `{ books: [{ id, title, author?, format, toc, createdAt }] }`. Needs `project`.
- `toc` — one book with its table of contents: `[{ n, title, chars }]`. Needs `project` + `book`.
- `chapter` — one chapter's body, paged: `{ title, html, offset, nextOffset?, totalChars, chapters }`. Needs `project` + `book` + `chapter` (1-based). A long chapter pages: pass the answer's `nextOffset` back as `offset` until it is absent.
- `roadmap` — `{ roadmap?: { bookId, nodes: [{ id, title, goals, chapterRanges, dependsOn, state, quizStats }], passRatio?, generatedAt } }`. Needs `project`. No `roadmap` key = none written yet.
- `vocab` — `{ entries: [{ id, kind, term, note, context?, chapterRef, source, mastery: { box, dueAt, streak } }] }`, ledger order. Needs `project`; `kind` narrows.
- `due` — the cards due for review, lowest box first. `project` optional (without it: every project's), `limit` optional (default 100).
- `quiz` — without `quiz`: the project's quiz list; with it: the whole quiz (questions with answers and evidence). Needs `project`.
- `stats` — the whole library's tally: projects, books, vocab, due, quizzes, attempts, and a box histogram.

## library_write — `what` ∈ project | book | roadmap | notes | quiz

- `project` — `{ project: { name, domain? } }`. The name is what the learner calls the subject; a duplicate name is refused (open the existing one instead).
- `book` — `{ book: { project, title, author?, format: "epub"|"md", chapters: [{ title, html }], replaceId? } }`. For content you already hold (a pasted text you split). Files go through the 图书馆 tab's drop zone — EPUB parsing lives in the browser. Every chapter needs a non-empty body.
- `roadmap` — `{ roadmap: { project, book, nodes: [...], passRatio?, regenerate? } }`. Node: `{ id, title, goals: [...], chapterRanges: [{ from, to }], dependsOn: [...], state: "locked"|"current"|"done" }`. Rules: ids unique; a node lists after everything it depends on; `current`/`done` requires all deps `done`; ranges are 1-based inclusive and inside the book. Revisiting an existing roadmap may only move a node one edge forward (locked → current → done) — re-splitting needs `regenerate: true`. A fresh roadmap starts with its root(s) `current` and everything else `locked`. `passRatio` defaults to 0.8.
- `notes` — `{ notes: { project, entries: [...] } }`. Entry: `{ kind: "vocab"|"keypoint", term, note, context?, chapterRef: "ch:<n>", source? }`. A (term, chapterRef) the book already holds merges — mastery is never reset by re-sighting. For a photo of handwritten notes: transcribe every visible term/point into entries and set `source: { kind: "photo", attachmentId, mediaType, bytes, width, height }` copied VERBATIM from the message's image block — the photo is never copied, only referenced. If the image block is not visible to you, ask for the notes as text.
- `quiz` — `{ quiz: { project, scope: { book, node? }, questions: [...] } }`. Question: `{ id: "q1", kind: "choice"|"fill"|"free", prompt, options?: [...], chapterRef: "ch:<n>", evidence, answer, vocabIds?: [...] }`. The **evidence gate**: every question must carry `chapterRef` naming a real chapter AND `evidence` quoting the original passage (a sentence or two, verbatim) its answer grades against. Missing either refuses the whole quiz and says which question failed. A quote the chapter does not literally contain is stored but returned in `warnings` — re-read the chapter and fix it. A choice question needs at least two options. `scope.node` ties the quiz to a roadmap node (its pass ratio gates the node's completion); `vocabIds` names the cards a question probes, so grading them moves their boxes.

## library_assess — grading, then the cascade

`{ project, quiz, verdicts: [...] }`. You judge first — read the quiz (`library_read · quiz`), compare each answer against the question's `answer` and `evidence`, and say the per-question verdicts in the conversation. Then assess: one verdict per question, the dataseek.verdict/1 shape: `{ task: "<question id>", criterion: "<what you judged>", pass: true|false, ratio?: 0..1, evidence: "<the passage you leaned on>", by: "llm"|"self"|"user" }`.

The engine then: appends the attempt, moves every probed card (pass climbs one Leitner box, fail resets to box 0 due tomorrow), updates the gated node's quiz stats, completes it at or above the pass ratio, and unlocks its dependents. The answer is `{ attempt, vocabUpdates, unlocked, completed? }` — report it honestly: what passed, which cards moved, what unlocked. A `task` naming no question of the quiz is refused with the real ids listed.

## Error self-correction, the short list

- `no project "…"` → `library_read · projects`, then use a real id (or `library_write · project` to create one).
- `chapters 1..N` → your `chapterRef`/`chapter` is out of range; `library_read · toc`.
- `chapterRef … the convention is ch:<n>` → rewrite the ref, retry.
- `carries no usable evidence` → quote the passage from the chapter (read it), do not paraphrase.
- `may not move done → current` (or any backward edge) → the state machine has no way back; to re-split, `regenerate: true`.
- `judges task "…", which quiz … does not ask` → the refusal lists the quiz's real question ids.
