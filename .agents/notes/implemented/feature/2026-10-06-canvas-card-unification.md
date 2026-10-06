# Agent Note: one card tool — canvas_read / canvas_write with genre hooks, novel_* keep the novel-only parts

Status: implemented

Follows [the writing-preset fold](2026-10-06-writing-preset-fold.md), which left two card writers side by side. The user asked whether `canvas_write` and `novel_write` would keep fighting, and preferred calling `canvas_write` over a second set of card tools. Approved: route cards through the canvas tools, and on a novel canvas point manuscripts at the chapter flow.

## Problem

- On a 长篇小说 canvas the model had two card writers. `canvas_write op=card` refused with "use novel_write" (the genre's `agentCardTool`), and `novel_write(what=card)` landed the card live.
- The model learns the canvas tools first (the canvas skill, the writing persona), so on a novel canvas its first card write was a refusal and a retry.
- `novel_read` had its own `cards` and `card` reads, `novel_write(review)` had its own archive, and the novel skill taught a second vocabulary (role, id) for the same cards.

## Decision

**Canvas (`@khorsheed/dsh-canvas`)**

- `CanvasGenreDefinition.agentCardTool` is replaced by optional `agent` hooks (`CanvasGenreAgent`):
  - `cardLines`, `cardDetail`, `writeCard`, `resolveCard`;
  - optionally `manuscripts` and `manuscriptGuide`.
- The session parameter is a structural `object`. Importing the host `Session` into `types.ts` broke the client tsc.
- **`canvas_read`**
  - On a hooked genre canvas, the genre lists its own categories (those with a role); the other categories list generically.
  - New `cardId` reads one card in full: the genre's detail, else a generic render.
  - `kind` also accepts the category's displayed name.
  - When the genre owns manuscripts, the manuscripts section is the genre's listing.
- **`canvas_write op=card`**
  - Asks the genre first. `undefined` means "not mine", so the generic proposal path runs.
  - `cardId` with fields patches a genre card. On a plain card it answers that the user edits it (comment or propose instead).
- **New `op=archive`**: archives a card through the canvas's own status (`patchCard` archived). The genre resolves refs such as `#12` to card ids. Comment resolution goes through the genre too.
- **`op=manuscript`**: on a genre that owns manuscripts, returns the genre's guide instead of writing.

**Novel (`@khorsheed/dsh-canvas-novel`)**

- New `src/genre-agent.ts` with `novelGenreAgent(store)`. It holds the card helpers that used to live in `tools.ts`.
  - Every hook gives new cards their refs first.
  - `kind` maps to a role by category id, then by label.
  - New cards land live, with the ref and the ✦ answer.
  - A namesake is refused, pointing at `canvas_write(op=card, cardId=ref, …)`.
  - An unknown ref is refused, unless it is a real board card outside the role categories (that card is the canvas's).
  - `manuscripts` is the chapter list "章节（N 章，按顺序）", sorted by seq.
- `index.ts` registers `{ ...NOVEL_GENRE, agent: novelGenreAgent(store) }`.
- Narrowed tools:
  - `novel_read`: brief, chapters, ledger, pending, chapter.
  - `novel_write`: chapter, and review with pending items only (`id`, `action` = accept|discard).
  - `novel_extract`: unchanged.
- `ReviewAction` drops `archive`. `NovelService.archiveCard` is deleted; it had no caller left.
- Texts move to the canvas tools: the skill, the pointer section, the brief's relation overflow hint, the extract report, the READMEs, and the writing preset's persona and comments.

**Chapter order**: `novel_write(what=chapter)` numbers a new chapter max+1, and both the chapter listing and the `canvas_read` manuscripts section are sorted by seq. The model sees the chapters in order from either tool.

## Alternatives considered

- **Keep `novel_write(card)` and make `canvas_write` delegate to it.** Rejected. That keeps two tools for one act, and two vocabularies in the skills.
- **Drop the novel's card behaviour (refs, live cards, duplicate check) and use generic proposals.** Rejected. Live cards and refs are what the brief and the ledger rely on.
- **Let `op=manuscript` write a chapter on a novel canvas.** Rejected. A chapter needs a confirmed plan and a fenced file write, which `novel_write(chapter)` already does. The canvas answer points there instead.

## Consequences

- One card vocabulary across every canvas. Genre packages that want special card behaviour implement the hooks rather than adding a tool.
- The novel's card behaviour is only reachable through the canvas tools. The canvas `./agent` row must be granted wherever the novel tools are (the writing preset carries both).
- **Tests**:
  - canvas `tools.spec`: plain-canvas patch refusal, `cardId` read, archive, archive of a missing card, a fake genre with hooks, and `kind` by name.
  - canvas-novel: new `genre-agent.spec` (live card, ref patch, namesake, archive via `patchCard`, non-role kind steps aside, card lines and detail, chapters in order, plain canvas). `tools.spec` asserts the narrowed enums. The store and import specs archive through the fake canvas.
