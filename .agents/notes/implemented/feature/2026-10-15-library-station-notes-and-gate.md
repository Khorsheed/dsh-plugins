# Agent Note: Library — station notes (讲义), the missed-question section, and one gate tab called 章节考

Status: implemented

## Problem

Compared against the learner's file-based calculus workflow (`~/code/calculus`: per-chapter `notes.md` / `exercises.md` / `solutions.md` / `mistakes.md`), the library's per-station loop had two gaps and one confusion: the coach's teaching lived only in the chat scrollback (no re-readable 讲义), wrong answers fed cards but were never visible per station (no 错题本), and the gate tab changed its name by node kind (`quiz` → 章节考, `practice` → 验收), which read as two different rituals. Design storyboard: `proposals/prototypes/library-two-journeys.html` (local, gitignored).

## Decision

- **A — station notes**: `RoadmapNode.notes?: LibraryNodeNotes` (`{ text, updatedAt, revisions }`, markdown, coach-written only). `library_write · notes { node, text }` → `service.putNotes` writes onto the ADOPTED path's node (book scope or project scope via the same binding default as roadmap), bumping `revisions` each write; `adoptRoadmap` keeps a surviving station's notes across re-plans (same id); `normalizeRoadmap` passes the field tolerantly; a `node.noted` event lands on the ledger. The sidebar gains a 讲义 tab (between 我的记录 and 章节考): meta line (when · 第 N 次更新), a deliberately minimal markdown renderer (headings / bullets / paragraphs / bold / code), an empty state, and a 「请教练写讲义 / 补讲」prime. On a 讲授 (topic) station the notes ARE the textbook — the "what kind is the LLM-authored textbook" question's answer: not a book on the shelf (that would pollute the evidence gate), but the per-station notes the coached teaching precipitates.
- **B — missed-question section**: the 章节考 tab lists 「这一站的错题」 — every quiz's latest sitting (attempts joined client-side by `quizId`; `listAttempts`' `nodeId` parameter turned optional at the contract since quiz sittings key on `quizId`), each failed non-void verdict mapped back to its stored question (prompt + correct answer, lettered for choice). One 「重考错题」button primes the conversation to compose a fresh quiz around the same weak points. No new storage: quizzes and attempts already held everything.
- **C — one gate tab**: the node view's gate tab is labeled 章节考. A knowledge (quiz) station shows the quiz sheet. The `node.acceptance` locale key is gone. **Superseded half (2026-10-16)**: a practice station no longer shows an acceptance sheet — the `acceptance` tab id, the sheet and its submit-for-acceptance prime are removed, and practice acceptance is conversation-only; see [the acceptance-tab removal](../simplification/2026-10-16-library-acceptance-tab-removal.md).

## Alternatives considered

- **Full markdown rendering for notes**: rejected — a dependency and attack surface for what is coach-authored plain teaching; the five-construct renderer covers what the prompt asks the coach to write.
- **Persisting the learner's answer per verdict for the missed rows**: rejected — verdicts carry criterion/evidence, not the raw answer; adding it would grow the wire shape for a caption the correct answer already serves.
- **Renaming the tab id `acceptance` → `quiz`**: rejected — the id rides stored navigation state; only the label needed to unify.

## Consequences

- The two journeys (read one book / domain path) now share the complete per-station loop: 导读 → 学原材料 → 讲义 → 章节考 (quiz sheet or deliverable) → 错题/卡片 → unlock — the storyboard's claim made true in code.
- The coach's prompt gains the 讲义 discipline (write when teaching ends, rewrite as 补讲 deepens; textbook on 讲授 stations, marginalia on book stations).

## Testing

`service.spec.ts` (+2): notes write/rewrite/re-plan survival on a book path; project-path notes plus the teaching refusals (unknown node, empty text, no adopted path). `store.spec.ts` (+1): normalize keeps well-formed notes, drops a torn one. `tool.spec.ts` (+1): `library_write · notes` via the binding default and `book: null`, JSON-text payload, the teaching errors. `pnpm --filter @khorsheed/dsh-library build && test` green; `pnpm check:panels --package packages/library` clean.
