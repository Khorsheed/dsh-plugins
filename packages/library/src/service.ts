/**
 * The library service core: owns the store and every rule the data answers
 * to. The Remote face next door is a thin adapter with no logic of its own;
 * the model tools (`tool-definition.ts`) translate these same outcomes into
 * thrown, teaching errors.
 *
 * The rules that live here and nowhere else (v5 — the six-layer model):
 *
 * - **Resources are registered, never uploaded**: a thick one (toc present —
 *   a TEXTBOOK: a book, a course with episodes, a coach-authored outline)
 *   carries title, kind, contents and their source, sits in the project's
 *   study order (`seq`, gapless from 1), and can be routed, covered by
 *   chapter, quizzed and photographed; a thin one is a shelf link a station
 *   cites.
 * - **Roadmaps are drafted by the coach and adopted by the learner**, one
 *   path per textbook (the project carries none — proposal
 *   2026-10-19-library-book-paths). A draft is free to change and a new one
 *   replaces the old; adoption initializes the
 *   state machine (roots `current`, the rest `locked`), keeps the progress
 *   of nodes that survive a re-split, and materializes every acceptance
 *   station's rubric as its practice assessment. The adopted path only moves
 *   forward: `locked → current → done`, by an assessed quiz (quiz gates),
 *   acceptance (acceptance gates) or 「读完」 (read gates).
 * - **Cards dedupe on the write path** (`cards.ts`): an exact key merges,
 *   a near match is held back with candidates for the coach to decide.
 * - **Quiz questions carry two axes** — target (marked / asked / missed /
 *   topic) and evidence (photo / web / knowledge) — and a station's covers
 *   decide whether memory may back a CONTENT question (a material book, a
 *   thin link or a bare url among them demands a verbatim quote).
 * - **The assess cascade** is the only cascading write: verdicts land in the
 *   ledger keyed by ASSESSMENT, then move the probed cards (mastery and
 *   weakness), then the gated node's stats; a node at or above its pass
 *   ratio completes and unlocks.
 * - **Photo provenance is a reference, never a copy**, and reading the bytes
 *   back is whitelisted to pages the project recorded.
 *
 * @module @khorsheed/dsh-library/service
 */
export { LibraryService } from './service/bindings.ts'
export { LibraryDisposedError, leitnerDueAt } from './service/core.ts'
export { unlockReady, validateRoadmapShape, coversVerbatimBlocker } from './service/rules.ts'
