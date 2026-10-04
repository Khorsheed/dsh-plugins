# Agent Note: canvas-novel — the story-bible engine re-keyed on canvases and cards

Status: implemented

## Problem

story-bible kept a work as its own tables (`memories.json`, `characters.json`, per-work journals) and drew its own browser UI. The canvas genre proposal ([2026-10-04-canvas-genres-and-novel](../../proposed/architecture/2026-10-04-canvas-genres-and-novel.md)) folds it into the canvas as the 长篇小说 genre: a work is a canvas, its settings are cards. Step 2 of that proposal — move the package, strip the old client, re-key the engine on canvases and cards — needed doing without leaving two sources of truth or dead code behind.

## Decision

- **One package, renamed**: `@khorsheed/dsh-story-bible` → `@khorsheed/dsh-canvas-novel` (identity triangle, service `canvasNovel`, tools `novel_read` / `novel_write` / `novel_extract`, section `novel:pointer`, skill `novel`, state `$DSH_HOME/state/novel/<canvasId>/`). The browser half is gone; the UI lives in the canvas's genre seams. **No migration** of `state/story/`.
- **Genre registration** through deferred injection on `ctx.canvasBoard`: the genre seeds four categories (人物 / 世界 / 原则 / 伏笔) with their field definitions. No canvas, no genre; every engine verb answers `missing`.
- **Session binding decides scope**: the `./agent` entry grants the three tools on each agent's own scope only while its session is bound to a 长篇小说 canvas, and re-evaluates on `canvas/binding-changed` and `canvas/genre-changed` (superseded evaluations never land). Unbound sessions see the tools absent, not denied. The pointer section and the skill still register once; the pointer renders '' unbound.
- **Cards are the single source of truth.** Refs are display names kept in the `annotations.json` sidecar alongside the engine notes (tension, current state, confidence, `autoImported`): characters `c<n>`; world, principle and foreshadow share one number space (`w<n>` / `w<n>` / `#<n>`), new card = max + 1. Journals (`experiences.jsonl`, `mentions.jsonl`) key on card id.
- **Ghost cards**: `novel_write(card)` without an id proposes a card (canvas `proposed`, `createdBy: 'agent'`), requiring the role's main field; it stays out of the brief until accepted. With an id it merges fields in place; unknown keys and out-of-option select values come back in `ignored`. `review` actions: accept / discard (proposed), archive (kept), retract (kept and auto-imported). Cards are never deleted.
- **Reconciliation** keeps its five gates; new settings, foreshadows and characters from extraction land as ghost cards, high-confidence facts import automatically (retractable). The pending queue shrinks to `mention`, `experience` and `plan-missed`.
- **Deleted**: `memories.json`, `characters.json`, the old client, `remote.ts`, and every code path that read them.
- **bundle-writing** follows the rename (grant row `@khorsheed/dsh-canvas-novel/agent`, persona and comments name `novel_*`).

## Alternatives considered

**Keep the engine tables and mirror them onto cards.** Two sources of truth, with the sync bugs that go with them; the user agreed the cards are canonical.

**Keep `story_*` names for continuity.** Nothing outside this repo depends on them yet, and a half-renamed package is harder to read than a clean break; renaming now with no migration was the user's call.

**Character knowledge, secrets and relations as engine state** (as the proposal sketched). They are things the author edits by hand, so they became multiline card fields; the engine only keeps what it derives.

**Grant tools with `restrict deny` on the root row.** Denied tools still show up as refusals; per-scope registration makes them absent, which is the cheaper and clearer state.

## Consequences

- A canvas with no genre is untouched: everything here hangs off the genre and the binding.
- **Origin seam**: cards imported through `putCard` (high-confidence auto-imports) carry the canvas's `createdBy: 'user'`; the agent origin of those cards lives only in the sidecar's `autoImported` note until the canvas grows an origin parameter on `putCard`.
- **UI gaps** (acceptable for now, tools cover them): chapter reader, foreshadow ledger page, character sections, pending strip, undo, badges.
- Old story-bible notes stay as history and link here.

## Testing

`pnpm --filter @khorsheed/dsh-canvas-novel test` (45 tests: store, tools, import, brief, agent, preset-scope) and `pnpm --filter @khorsheed/dsh-bundle-writing test` (7), both after a full build; `pnpm gate`.

## Related

- [Proposal: canvas genres and novel](../../proposed/architecture/2026-10-04-canvas-genres-and-novel.md)
- [story-bible M1](2026-10-04-story-bible-m1.md)
- [story-bible M3 client](2026-10-04-story-bible-m3-client.md)
- [story-bible preset grant](2026-10-04-story-bible-preset-grant.md)
- [story-bible F1 first-session fixes](2026-10-04-story-bible-f1-first-session-fixes.md)
