# Agent Note: Library project-level paths — mixed covers, practice stations, the reference-level evidence gate (project-paths M2, state v3)

Status: implemented

## Problem

Until now a library roadmap rode exactly one book: `chapterRanges` counted its contents rows, and the quiz evidence gate was a book-level rule (`material` books never take memory-backed content questions). The project-paths proposal (`proposals/active/2026-10-13-library-project-paths.md`) answers the no-single-textbook scenario: a project's path whose stations draw on mixed sources — a book's chapters, a shelf resource, a bare url, or plain coached teaching — plus hands-on stations that complete by acceptance, not by a quiz. 3080 holds real v2 data (book paths, cards, quizzes), so the shape change needed a real migration, not a version bump that reads the old root as empty.

## Decision

State v3 (`packages/library/src/types.ts`): `RoadmapNode.chapterRanges` is replaced by `covers: LibraryNodeCover[]` — `{ kind: 'book', bookId, ranges } | { kind: 'resource', resourceId } | { kind: 'url', url, title? } | { kind: 'topic', text }`, each carrying optional provenance (`by: web|model|user`, `verifiedAt`). `LibraryRoadmap.bookId` is optional: absent = the project's own path (`projects/<id>/roadmap.json`); a book's path is the special case whose every node covers that one book (enforced at draft time). Node kind gains `'practice'` with `acceptance: string[]` (required there, forbidden elsewhere). `LibraryQuiz.scope.bookId` is optional (absent + nodeId = a project station; both absent = a free quiz). `LibraryAttempt` carries `quizId?` / `nodeId?`, exactly one.

- **Migration** (`store.ts` `migrateState`): a v2 index reads tolerantly (`normalizeLibraryIndex` accepts 2 and 3; `normalizeRoadmap` wraps a legacy node's `chapterRanges` into the one book cover on the fly), and the plugin's `apply` fires `migrateState()` — under the index lock it rewrites every `books/<bid>/roadmap.json` / `roadmap.draft.json` (raw-JSON node edit: `chapterRanges` → `covers`, every other byte kept) under each project's lock, then bumps the version. Idempotent, crash-safe (the version bump lands last), v1 untouched (still reads as empty).
- **Verbs**: `getRoadmap` / `draftRoadmap` / `adoptRoadmap` / `discardDraft` / `markNodeRead` take an optional `bookId` (absent = project scope). `validateRoadmapShape` generalizes: covers must resolve (book exists and ranges fit its contents, resource on the shelf, url well-formed, topic non-empty), a practice node needs acceptance, and a quiz/practice node still never depends on a read node.
- **Evidence gate** (`putQuiz`): with a node in scope the gate reads its covers — only knowledge books / topic teaching allow a memory-backed content question; a material book, resource or url demands a verbatim quote (`coversVerbatimBlocker`). Book-scope without a node keeps the old rule byte-identical; a scopeless free quiz allows knowledge. Photo evidence resolves against the scoped book's pages, else the node's covered books', else the project's.
- **Practice acceptance** (`putAttempt`): the request takes exactly one of `quizId` / `nodeId`. The node path validates each `verdict.criterion` verbatim against the node's acceptance lines, computes the same credit ratio (partial credit rides the passRatio line — the proposal's default ruling), cards `missedCard`s (creating or re-weakening), and reuses the completion cascade (complete → `unlockReady` → events). No quiz entity is stored; the attempt ledger line carries `nodeId`.
- **Reads**: `listAttempts({ projectId, nodeId? })` (newest first) feeds the acceptance tab's history. `bindingSummary` reports the project path's current station when the binding names no book, so the coach sees it every turn.
- **Tools**: `library_write · roadmap` takes `covers` per node; `book` defaults to the binding's book, `book: null` means the project's own path; `chapterRanges` remains as sugar for the book special case (wrapped into its single book cover). `library_assess` takes `node` (+ `book` when the station sits on a book's path). The tool descriptions and the prompt section teach the provenance discipline.
- **Sidebar**: the project page gains the path card (adopted: every station with state dot, kind chip, covers summary, opening its node page; draft: the shared DraftCard with covers summaries and provenance badges). NodeView serves both scopes: a covers chip row under the header, 「我的记录」 only when the station covers a book (a picker when several), the third tab by kind (quiz → 章节考 with the 「凭什么」 policy card, a client mirror of the gate over the node's covers; practice → 验收 with the criteria, the submit-and-prime gesture and the history; read → none).

## Alternatives considered

- **A hard cutover (v2 root reads as empty until migrated)**: rejected — on a read-only root the data would hide forever; tolerant reads plus an idempotent rewrite give both correctness and honesty on disk.
- **`quizId` stays required and practice attempts forge a quiz entity**: rejected — a fake quiz row would pollute listQuizzes and the node's quiz tab; the optional `nodeId` on the attempt is the smaller lie (exactly one of the two keys, pinned by normalizeAttempt).
- **Card movement on practice verdicts** (lifting cards named by the coach): the verdict shape carries no cardIds, so a pass moves nothing and a fail only cards `missedCard` — matching what the acceptance flow actually knows.
- **A separate practice source type on cards**: `LibraryCardSourceType` stays four; acceptance misses record as `quiz` (the 「我答错的」 filter already means "failed at a gate").

## Consequences

- A project can run a no-textbook course end to end; books keep their pages (photos still hang on a book) and their own paths (both paths coexist, each with its own ledger).
- The old book flow is byte-identical for learners: the same tool calls (chapterRanges sugar), the same gate verdicts, the same cascade.
- `dsh-library` state on 3080 migrates on the first boot of this build; until it lands, every read path wraps v2 nodes on the fly.

## Testing

`store.spec.ts` (+5): the project-root path round-trip, normalizeNodeCover, the v2 fixture (adopted + draft + cards + quiz) migrated losslessly, idempotence, v1/fresh-root no-ops. `service.spec.ts` (+13): project-path verbs without bookId, covers validation, the book special case, the covers-driven gate (material / knowledge-only / url / free / node-on-book-path regression), practice acceptance (verbatim criteria, 2/3 under the line then 5/6 over it, missedCard, history, events), the project-only bindingSummary. `tool.spec.ts` (+2): the project draft via `book: null`, the chapterRanges sugar, the assess-by-node path. All pre-existing tests pass unchanged in behavior (fixtures mechanically re-expressed as covers). `pnpm --filter @khorsheed/dsh-library build && test` green; `pnpm check:panels --package packages/library` clean.
