# Agent Note: Library v5 — the six-layer model (Resource merge, one roadmap, one gate, one cover shape, Assessment entities)

Status: implemented

## Problem

The v3/v4 lines had accreted a dual-track structure, and the live error rate pointed at the concepts, not the transport: a book and a resource were different entities with different rules (what may be covered, what may carry a roadmap, what may be quizzed); a roadmap lived at two scopes (per-book, per-project) with a mirroring validation rule to keep them apart; a node's `kind` combined with three more fields to say how it completes; a cover was a four-member union; and a practice station's acceptance had no entity at all — its attempts keyed the NODE, so a replan that reworded a rubric line orphaned the station's history. The model (and the maintainers) paid for every redundant pairing.

## Decision

One pass over the store layout and every face, per the proposal ([proposals/active/2026-10-16-library-v5-model.md](../../../proposals/active/2026-10-16-library-v5-model.md)):

- **A book IS a resource.** `LibraryResource.kind` gains `'book'` (and `'course'` carries a toc too); `toc` is the thick/thin switch — a resource with contents can be routed, covered by chapter, quizzed and photographed, a thin link enters a path whole. Book-ish detail (bookKind, extras, short, author, edition, isbn) lives in `meta`. `LibraryBook` is gone.
- **One roadmap per scope**, keyed `primaryResourceId?` (absent = the project's own path). Stored at `roadmaps/<key>.json` — no more `books/<b>/roadmap.json` beside a project-root `roadmap.json`.
- **A node's `gate`** (`quiz | acceptance | read`) says the one way it completes; the old `kind` × `acceptance` × side-station combination rules collapse into it.
- **One cover shape**: `{ ref, locator? }` where the ref describes itself — a shelf id, a bare url, or `topic:…`; a locator counts contents rows ("1-5,7"). The tools additionally take the string shorthand (`"r_…#1-5"`), and `normalizeCoverArg` still parses every v3/v4 union member.
- **Assessment is an entity** (`assessments/<id>.json`): `type: "quiz"` carries questions, `type: "practice"` carries an acceptance station's materialized rubric. Adoption materializes each acceptance node's rubric — an unchanged rubric reuses the live assessment (its attempts stay attached), a changed one supersedes. A node's new quiz supersedes the station's live one. **An attempt keys only `assessmentId`** (a verdict's `task` is a question id or a rubric line id).
- Foreign keys renamed with the merge: `bookId` → `resourceId` on pages, cards (and their contexts), bindings, events.

**Read-old, write-new, no offline pass.** Every normalize* reads the legacy shapes (a `books/<id>/book.json`, a `resources.jsonl` line, a `quizzes/<id>.json`, a node `kind`, a cover union, a `quizId`/`nodeId` attempt key) and every writer lands only in the v5 layout; legacy files stay in place, so a rollback loses nothing. `LIBRARY_STATE_VERSION` is 5; the index reads v2–v5. The v2 `migrateState` pass is untouched.

The tool face folded with the model: `library_book` is gone — `library_resource` covers both branches (thick: kind book/course + toc; thin: title + url), with `from: { project, resource }` cloning an entry across projects. Every scope parameter is `resource` (the `book` spelling still parses on the untyped surface); a node's field is `gate` (`kind: "practice"` still parses); ten tools now.

## Alternatives considered

- **An offline migration pass rewriting every file to the v5 layout**: rejected — the proposal's rule is read-old, write-new with zero downtime; every normalize* already reads the legacy shapes, and leaving the old files in place keeps rollbacks lossless.
- **NodeRef as a table of its own** (the user's first draft): rejected in the proposal discussion — a roadmap is read whole in one file; a join per cover is pure loss.
- **Workspace-global resources with a project link table**: rejected for now — every read path would gain a join to serve one real pain (re-verifying a book per project); cloning through `from` is lighter.
- **Keeping `library_book` beside `library_resource`**: rejected — two write paths for one entity is exactly the dual-track redundancy this pass removes; the `book` argument spelling still parses where models memorized it.

## UI — one station page, four tabs

The node page no longer varies by gate: every station carries 导读 / 我的记录 / 讲义 / 章节考. The gate tab reads the station's Assessment — a quiz/read station's papers (current paper + superseded history + same-scope loose papers), an acceptance station's rubric sheet (restored: criteria with stable line ids, machine-checked ref lines opening their quiz, the submit-to-conversation gesture, the history). This undoes the practice station's tab-less state from `050039be` — the unified gate tab is the proposal's design (客户端还变简单: one read path).

## Consequences

- **Entity ids**: fresh resources mint `r_…` (legacy `b_…` / `res_…` ids keep working — discrimination is by shelf lookup, never prefix); assessments mint `q_…` (practice ones too). Attempts minted before v5 keep their legacy `nodeId` key as a read-compat field; `listAttempts(nodeId)` joins through the node's assessments and the legacy key alike.
- **The Remote face renamed with the model** (`getResource`/`putResource`/`removeResource`, `listAssessments`/`getAssessment`, `resourceId` everywhere) — client and host ship together, so there is no alias window on the wire.
- A malformed cover ref (a scheme-less url) now earns a teaching refusal at the shape gate instead of escaping as a store-level assert (`isLibraryId` guards the shelf lookup).
- The practice station's acceptance history is re-homed onto materialized assessments on first adopt/assess; pre-v5 attempts stay attached to their node and still list.
- A read node's 章节考 tab offers loose papers and the ask — a station-gated quiz on a read node is still refused at the write gate (nothing to gate on).

## Testing

142/142 green. store.spec.ts pins the migration contract with a hand-written v3 layout read back through the v5 store (the book, the thin-link ledger with a torn line, the roadmap with `kind: "practice"` and cover unions, the quiz with `scope.bookId`) plus the write-new shadowing rule. service.spec.ts and tool.spec.ts moved to the new face wholesale, keeping the v4-spelling alias tests (the `book` argument, `bookId`, `kind: "practice"`, `what: "books"`) and adding the cover string shorthands. `check:panels` clean.
