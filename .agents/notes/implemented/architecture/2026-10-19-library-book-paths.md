# Agent Note: Library — every path belongs to a textbook (the project carries none)

Status: implemented

## Problem

v5 kept a roadmap at two scopes — a thick resource's own path (`primaryResourceId`) or the project's own (absent) — and the tools derived the scope from the covers: the same single resource on every station landed on that resource, anything mixed landed on the project. On 3080 (2026-10-19) the coach drafted a 《普林斯顿微积分读本》 path with one appendix read station (`topic:` cover); the derivation sent the whole path to the project. The coach noticed, redrafted on the book, never withdrew the first draft, and the learner adopted the project one on the project page — while the coach reported "landed on the book's own path". Two homes for a path, an invisible derivation choosing between them, and two drafts that could coexist: the model and the learner could each be wrong without seeing it.

## Decision

Per the proposal ([proposals/active/2026-10-19-library-book-paths.md](../../../proposals/active/2026-10-19-library-book-paths.md)), decided with the user:

- **A path belongs to exactly one textbook** — a resource with a contents (v5's thick resource). The project carries no path: `roadmaps/<resourceId>.json` only; a legacy `roadmaps/project.json` (or root `roadmap.json`) reads as absent, and `writeRoadmap` refuses a path without its textbook. Scope derivation (`deriveRoadmapResource`) and the "a resource's own path covers that resource only" / mirror rules are deleted; `library_roadmap` takes `resource` as a schema-required field.
- **A station names its textbook's rows as `chapters: "3-4"`** and side references as `also: [url | "r_…#2" | "topic: …"]`; both expand to the stored covers. A side reference never moves the path, and the evidence gate judges a station by its own textbook's cover when it has one (a side video no longer makes a knowledge chapter quote-only). A station naming neither rests on the textbook whole. A path need not cover the whole contents; the textbook page folds the skipped rows into 「本路线不学」.
- **Textbooks come from anywhere the coach decides** — `origin: learner | picked | authored` replaces `addedBy` (legacy `coach` reads as `picked`): the learner's own book, an existing book or digital course the coach picks (partial chapters are fine), or a coach-authored outline whose 讲义 are its text. Digital vs print stays `kind` + `url`.
- **Study order is `seq`**, gapless from 1 over the project's textbooks: assigned on shelving (an explicit `seq` inserts, otherwise last), `library_resource op: "move"` / the sidebar's ▲▼ reorder, closed up on removal. Order is advice, never a lock. No subject tags or subject layer — the user's call: subjects are open-ended; the coach finds textbooks for what the learner studies.
- **One draft per textbook** — a new draft replaces the old (`replacedDraft` in the tool result); the project page lists every textbook whose draft waits.
- **The model always reads the real state**: instead of pushing an "adopted" event into the session, the per-turn `Library:` context now lists every textbook in study order with its path state (adopted n/m + current station, draft waiting, no path). `bindingSummary` returns `textbooks` in place of `progress`.
- **Prompt and tool diet**: the `tool:library` section went from ~6.5k to ~1.9k characters — it states the journey (project → textbooks in order → one path each → teach → quiz → assess) and the non-negotiables; per-call rules live only in their tool description (quiz authoring in `library_quiz`, photos in `library_page`, weak points in `library_cards`, 讲义 in `library_notes`). Tool descriptions + schemas went from ~25.5k to ~21k characters; the JSON-text transport branches stay (models that stringify nested args still need them). `library_binding` is flat (`project`, `resource`, `unbind`); `from` cloning and the `covers` / `chapterRanges` / `addedBy` spellings parse but are no longer advertised. The learning persona's "curate the project's own path" paragraph now says: choose or author textbooks, numbered in study order, one path each.

## UI

The project page drops the project path card and project draft card; it shows 继续学习 (the first textbook in order with a current station), a banner for waiting drafts, textbooks as a numbered list (origin tag, progress, current station) with a reorder mode, and the links. An empty project offers 我有书 / 帮我选教材. 今日 gains a 继续学习 card across projects. Deleting a project moved from the bottom of the edit form to the page's menu; deleting a project or a textbook opens a confirm dialog listing what goes (textbooks, cards with due count, sittings, links / path progress, pages, quizzes) and what stays. The textbook page shows its number and origin, names the adopt button 「采用为本书路线」, and folds skipped chapters. A station always belongs to a textbook (the route's `resourceId` is required).

## Follow-up: the first live run (3080, 2026-10-19 evening)

A free OpenRouter model (`thinkingmachines/inkling:free`) ran the journey once and hit four refusals; three were the tool layer's fault, not the model's:

- **A contents joined on one line.** The model sent 30 chapters as one `；`-joined string, so the book got one row, every station's `chapters` fell out of range, and the model "fixed" it by dropping chapters (each station then covered the whole book). Now `splitTocText` splits a single line on `；`/`;` (three parts or more) and literal `\n` escapes; the shelving result carries `contentsRows` and a warning under 3 rows; and the out-of-range refusal says to fix the contents with `resourceId`, never drop the chapters.
- **An opaque schema refusal.** A quiz with 5 of 20 questions missing `answer` was refused as `"questions" must match exactly one oneOf branch` — naming nothing. Nested `required` flags moved out of the question and node item schemas (marked "Required" in descriptions); the tool coerces missing fields to blanks so the service's per-question check names each one.
- **Points on an acceptance station.** Dropped with an `adjusted` note instead of refused. `chapters` also reads any dash or separator, and words in it ("27-30 + 附录A") become a `topic:` side reference.
- **Binding to a guessed id** (`calculus_lifesaver`, before registering) now binds the project and returns a note — model behavior, but not worth a red call.

- **Fill answers judged wrong when right** (sidebar `judge.ts`): the key was split into alternatives on every `/`, so the key `1/2` became `1` or `2` and no answer could match — a plain bug. The whole key is tried first and alternatives are only `" / "`, `|`, `或`; answers also match by value (a small parser, never eval: fractions, decimals, `\frac`, `½`, `%`, `√`, `π`) and part by part for multi-blank answers whatever the comma. What still disagrees, the learner overrules with 「我答对了」 (ledgered `by: self`, the criterion says so). `library_quiz` now states these conventions.

Sidebar: 章节考's 范围 defaults to 都考; the settings and the pending ask live in the pane store per station, so leaving the tab keeps both, and a 「教练正在出题…」 card (what was asked, how long) stays until the paper lands — after 8 minutes it says none has landed and offers to ask again.

## Alternatives considered

- **Keep both homes, fix the derivation** (judge scope by quiz stations only, withdraw sibling drafts): rejected — it shrinks the error but keeps an invisible choice the model can still get wrong.
- **An independent Course entity with books as materials** (an intermediate draft in the discussion): rejected — a course with no main book is a project path under another name; once the coach may author a textbook, the extra layer buys nothing.
- **Subject tags or a subject layer between project and textbook**: rejected by the user — subjects never end, and the model would make one more classification call.
- **A prerequisite graph between textbooks**: rejected — a numbered order says enough and is lighter for both the learner and the model.
- **Pushing an adoption event into the bound session**: rejected — the per-turn context already rides every turn; stating each textbook's state there covers adoption, discard and reorder alike with no new host seam.

## Consequences

- Data: production state was empty when this shipped (the user deleted the history), so there is no migration pass; a stray legacy project path is simply not read.
- The Remote face: `getRoadmap` / `adoptRoadmap` / `discardDraft` require `resourceId`; `moveResource` is new; `putResource` takes `origin` / `seq`.
- Free quizzes (no textbook, no station) and textbook-level quizzes are unchanged.
- [Library v5](2026-10-17-library-v5-model.md)'s "one roadmap per scope" bullet is superseded by this note; the rest of v5 stands.

## Testing

153/153 green in the package. store.spec.ts pins textbook-keyed paths, the retired project path reading as absent and refusing writes, origin / seq normalization (legacy `addedBy`), and the shelf order. service.spec.ts covers the textbook-required draft (the refusal lists the shelf), one draft per textbook, side references beside the textbook's rows, the link-never-a-path refusal, seq placement / move / clamp / renumber-on-remove, and the binding summary's textbook list. tool.spec.ts covers `chapters` / `also` expansion, the required `resource`, `replacedDraft` and `waitingForAdoption`, `op: "move"`, the flat binding with `unbind`, and the per-turn context listing a waiting draft on another textbook. Screens were checked in the sidebar fixture (`examples/sidebar`) light and dark at phone width; `check:panels` clean for the package.
