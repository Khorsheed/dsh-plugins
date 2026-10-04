# Agent Note: Canvas genres, and story-bible folded into the canvas as the long-novel genre

Status: proposed

## Problem

story-bible (memory, characters, foreshadowing, chapters, reconciliation) and the canvas (cards, typed categories, manuscripts) grew as two products for one job: a writer's board. story-bible's own UI — two right-sidebar tabs, a work strip, a fragments wall — duplicates what the canvas already does better (cards, typed fields, a card page, manuscripts with version guards), and its look never matured. Its engine, though, is the valuable part: the reconciliation gates, the foreshadow ledger, per-chapter character knowledge and the retractable-auto-import invariant.

The user decided on 2026-10-04 (design page `proposals/prototypes/canvas-story-pack.html`, with the former story-bible owner's review written into its question section):

- All UI lives in the canvas. The engine stays its own plugin, a **genre** (创作体裁) the canvas can load. Each genre ships a cold-start version; the user's own versions come later.
- One work = one canvas. A writing session binds a canvas through a chip in the session header; the session perceives only the bound canvas, while the sidebar may show any canvas.
- Chapter bodies are workspace markdown files (the file is the source of truth); ordinary manuscripts keep living inside the canvas.
- A canvas with no genre selected behaves exactly as today, and the binding chip does not appear.
- No migration: story-bible is in testing and holds no works.
- story-bible is not handed back to its former owner: the canvas owner rebuilds it as `@khorsheed/dsh-canvas-novel`, moving the engine over (`git mv`, history kept) and deleting the old client outright.

## Proposal

### Canvas host seams (`@khorsheed/dsh-canvas`)

- **Genre registry** on `CanvasBoardService`: `registerGenre(def)` returns a disposer; `listGenres()` answers what is installed. A definition carries `id`, `label`, `version`, an optional `base` (the version it derives from — reserved for "save as my version"), `description`, the seed categories (`{ role, label, definition }`), and the name of the agent row that grants its tools (so the client can tell whether a session's preset carries the genre).
- **Board fields**: `CanvasBoard.genre?: { id, version, selectedAt }` and `BoardCategory.role?: string`. `normalizeBoard` keeps both (today it drops unknown keys). `role` is how a genre finds "its" category after the user renames the label.
- **`selectGenre(canvasId, genreId | null)`**: seeds every missing role category (idempotent), records the genre. Clearing keeps the categories and cards; it only unloads the genre surfaces. One genre per canvas.
- **Session binding**: `bindSession(session, canvasId | null)` / `boundCanvasId(sessionId)`, persisted in `<stateRoot>/bindings.json` (restart-safe, unlike today's in-memory focus map). Only a canvas with a genre can be bound. The canvas tools resolve their target as *bound canvas, else the sidebar-focused one*. Fork inheritance is a follow-up once a host fork signal is confirmed.
- **Change events**: `canvas/genre-changed` and `canvas/binding-changed` on the cordis context, so a genre can re-evaluate its per-session tool mask without polling.
- **File-backed manuscripts**: `BoardManuscript.storage?: { kind: 'workspace', workspace, path, token, externalEdits }`. Reads and writes go to the workspace file under the same `baseVersion` contract; a stat token that moved since the last read counts as an external edit (version +1, `externalEdits` +1). Deleting such a manuscript unregisters it and leaves the file alone. Ordinary manuscripts are untouched.

### Canvas client seams

Declared as child slots of the canvas tab registration and rendered with `renderSlot` (the ui-cordis `tool.view.cordis` pattern):

- `canvas.card.face` — keyed by category role; replaces the face of cards in that category.
- `canvas.card.section` — list; extra sections on a card page, after the body.
- `canvas.page` — keyed by page kind; a new `CanvasPlace` variant `{ kind: 'page', page, canvasId, param? }` routes to it (chapter page, foreshadow ledger).
- `canvas.board.strip` — list; a strip pinned under the board (pending review).
- The canvas ⋯ menu gains 创作体裁 when at least one genre is installed.
- The canvas registers the session-header binding chip itself; it renders only in sessions whose preset carries a registered genre's agent row, and lists only canvases with a genre.

### The long-novel genre (`@khorsheed/dsh-canvas-novel`)

- `packages/story-bible` moves to `packages/canvas-novel`. Kept and reworked: `store.ts`, `types.ts`, `brief.ts`, `skill.ts`, `tools.ts`, `agent.ts`, `remote.ts`, `invariant.ts` and their host tests. Deleted: the whole `src/client/` and its tests, plus every Remote verb only the old client called that the new surfaces do not need.
- **Settings become canvas cards** in role categories: characters (identity, core want/lack/wound, look, voice), world, principles, foreshadow. A foreshadow card stores only first-hand facts — question, status, planted chapter, answer; tension, dormancy and last activity are computed from the mention journal, never stored on the card.
- **The engine keeps** what the canvas has no shape for, keyed by canvas card id: character knowledge, current state, relationships with their change journal, experiences, mentions, pending review items, and chapter records (plan, phase, recap) keyed by manuscript id.
- **Chapter plan** gains `synopsis` and `beats[]` (`{ text, where?, who?, turn? }`). Reconciliation marks each beat written or not; a missed beat is a weak hint, escalated only when it misses two chapters running or carries a foreshadow op.
- **Start from existing chapters**: claim a folder's chapter files as file-backed manuscripts, extract a skeleton (roster, places, one-line synopses) as proposals, then reconcile chapter 1..N in order. The pack for chapter N contains only what existed through chapter N-1.
- **Skill** splits into a fixed workflow spine (plan → write → reconcile, the review gate) and replaceable method sections (foreshadow design, extraction rules, voice) — the override points for a future "my version".
- **Tools are mounted per session** only when the session is bound to a canvas whose genre is this one: `ctx.tools.restrict({ deny })` on a per-agent scope, re-evaluated on `agent/created`, `tools/change`, `canvas/genre-changed` and `canvas/binding-changed`.
- `bundle-writing` and `scripts/check-plugin-independence.ts` follow the rename; story-bible's `ui-content-preview` edge goes away with its reader.

### Order

1. Canvas host seams, then client seams — zero change for a canvas without a genre.
2. Move the package, strip the old client, re-key the engine on canvases and cards.
3. Chapter page with file-backed bodies, plan with synopsis and beats, the review gate.
4. Foreshadow ledger, character-page sections (knowledge, state, relationships, experiences), pending strip, start-from-existing-chapters.

Each step merges on its own. Between steps 2 and 4 the novel genre has no full UI; the user accepted that gap (the package is not in the 3080 profile).

## Alternatives considered

**Keep story-bible as its own UI and only link to the canvas.** Two boards for one book, two card models, and story-bible's UI would need the same maturing the canvas already went through. Rejected by the user.

**Make the engine part of the canvas package.** Every canvas would carry novel-specific logic and tools, and other genres (a thesis, an article) would have no seam to plug into. The genre split keeps the canvas generic.

**Bind sessions through a host session projection.** Binding would ride session history and survive forks for free, but no plugin-writable session event channel is confirmed on the current host line. A state-dir table is restart-safe now; moving to a projection later changes storage, not the API.

**Store derived foreshadow values (tension, dormancy) on the card.** The card and the ledger would drift apart. Only first-hand facts go on the card.

**Migrate story-bible works.** None exist outside tests.

## Acceptance criteria

- A canvas without a genre is byte-for-byte unchanged on disk after any operation, and its UI shows no genre surface; no binding chip appears in any session whose preset carries no genre.
- Selecting the novel genre seeds the role categories once; renaming a category keeps the genre working.
- A bound writing session's canvas tools and novel tools act on the bound canvas regardless of what the sidebar shows; the binding survives a host restart.
- Novel tools are absent from sessions not bound to a novel canvas.
- Editing a chapter file in an external editor bumps the chapter's version and a stale model revision is refused.
- `packages/story-bible` no longer exists; no code path references `@khorsheed/dsh-story-bible`.

## Risks

- The canvas is live on 3080; the seams must not regress the no-genre path. Every step gates on the existing canvas suites plus a no-genre round-trip test.
- File-backed manuscripts introduce writes outside the canvas state root; the fence must root them at the declared workspace and honor read-only sessions.
- The novel genre has no complete UI between steps 2 and 4.
- Binding fork inheritance is deferred; a forked session starts unbound until the follow-up lands.
