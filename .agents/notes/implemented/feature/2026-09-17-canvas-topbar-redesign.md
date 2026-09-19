# Agent Note: the topbar redesign — one CSS module of truth, no v1 import, a menu with one hierarchy

Status: implemented

English | [中文](2026-09-17-canvas-topbar-redesign.zh.md)

## Problem

On 3080 the canvas tab's topbar rendered as a mess: the switcher dropdown opened in-flow and stretched the topbar to the menu's height, floating "卡板|成稿 / ＋新卡" vertically into empty space — "顶部导航太草率，信息传递和层级很混乱". The user also named two content decisions: the v1-import capability can go, and the menu's own「画布 +新画布」header duplicates the topbar's semantics.

The root cause was one line: `CanvasSwitcher.tsx` imports `../space/board.module.css`, but its three positioning rules (`.switcher`, `.switcherMenu`, `.switcherMenu .listBody`) lived in `../tab/CanvasTab.module.css` — dead rules the task-switcher file never imported (CanvasTab itself used only `.switcherMenu` for its new-card menu). CSS Modules turn a missing class into `undefined`: the anchor and panel rendered with no position, no z-index, no background — an in-flow block instead of a floating menu. The deeper lesson is the pattern it came from: a shared stylesheet silently split across two files, where the class's owner and its definition drifted apart and nothing failed at build time.

## Decision

**One module of truth for the dropdown primitive.** `.switcher` (position:relative anchor), `.switcherMenu` (absolute panel: `top: calc(100% + 6px)`, z-index 30, border + radius + `bg-layer-3` + elevation, `max-height: 70vh`, flex column) and `.switcherMenu .listBody` (`overflow-y: auto`) moved into `../space/board.module.css` — the module the switcher actually imports. CanvasTab's new-card menu now imports the same module for that class (a comment marks why). The dead copies in `CanvasTab.module.css` are deleted, so the primitive has exactly one home.

**The v1 import is removed end-to-end.** The one-shot「导入 v1 灵感画布」flow is gone from every layer: the switcher's importBox JSX and its state, the tab's `submitImport`, the face members `importV1`/`probeV1Pad` (contract + apply wiring), the Remote `importV1` verb, the `CanvasBoardService.importV1` method, the `BoardImportV1Request`/`BoardImportResult` wire types, and the whole `import.*` locale key set in both dictionaries. What deliberately stays: the v1 pad's five verbs (`list`/`read`/`create`/`write`/`setArchived`) and the pad's files on disk — the pad is untouched storage, now without a migration path (the user judged it unused; if a migration ever becomes wanted again, the M1 commit `c56cc1ec` holds the full implementation).

**The tab is named what it is.** `tab.label`: zh 画布详情 → 画布， en 'Card detail' → 'Canvas' (the M1.5 name described only the detail reader; the tab is the whole workbench).

**The menu is one hierarchy.** The redundant「画布 +新画布」head row is gone. The dropdown is now: active canvas rows (title + meta + hover archive) → the archived well (collapsed, restore) → a bottom「+ 新画布」row that unfolds the inline create form (topic input + attach checkboxes + create/cancel). Outside-click and Escape still close; the topbar row itself is unchanged (`[switcher][attach chips][spacer][卡板|成稿 seg][＋新卡]`). Read-only mode no longer disables the create button — it hides the whole row (a disabled button is a promise the page can't keep; an absent row says the truth).

## Alternatives considered

### Why not duplicate the dropdown styles into both modules?

That is how the bug was born: two homes, one of them stale. CSS Modules gives no undefined-class error at build time, so a duplicated primitive is a bug with a timer. One module of truth, and the menu that isn't the switcher imports it explicitly — the rule this change also states for any future dropdown in this package.

### Why keep the import flow behind a flag instead of deleting it?

A hidden capability is code, tests, verbs, and locale kept alive for a path the user already called unused. The removal is a straight line (delete), the history holds the full implementation (`c56cc1ec` host, M2.5-era switcher UI), and a future migration need is a new design anyway — the M4 session-side indexing (`canvas_search`/`canvas_clip`) reaches v1 content differently than a one-shot copy.

### Why hide the create row in read-only instead of disabling it?

A disabled「+ 新画布」says "you could, if…" — but the if is "open a session first", which the row can't act on. Hidden, the menu simply tells the truth: there is nothing to do here until a session exists. The disabled-新画布 test updated accordingly.

## Consequences

- `packages/canvas/src/client/space/board.module.css`: gains the dropdown primitive (moved), `.newCanvasRow`, `.formNote` (renamed from the import-era `.importNote`); `.importBox` removed. `packages/canvas/src/client/tab/CanvasTab.module.css`: the dead duplicate rules removed.
- `packages/canvas/src/client/tab/CanvasSwitcher.tsx`: one-hierarchy menu, import flow removed, head row removed.
- `packages/canvas/src/client/tab/CanvasTab.tsx`: import flow removed; the new-card menu reads `switcherMenu` from the board module.
- `packages/canvas/src/client/{contract.ts,index.ts}`, `src/{remote.ts,store.ts,types.ts}`: the importV1/probeV1Pad surface removed (verb, method, wire types, face members). `src/client/locales.ts`: `tab.label` renamed, `import.*` keys removed.
- Tests: the importV1 describe (board.spec), the verb expectations (remote.spec), the switcher import test and mocks (tab spec) removed; the read-only test follows the hidden-row behavior. **164 tests green** (167 before: −3 import cases, −1 net switcher case, +1 read-only re-assertion… net −3 cases vs M3.1's 167).
- The [M1 note](2026-09-16-canvas-space-m1.md)'s importV1 record is superseded by this one (cross-linked); the pad itself and its five verbs stay.
- Version stays 0.4.1 (a polish wave, no wire addition — one verb removed, noted for the next publish checklist).

## Testing

- `packages/canvas`: **164 tests green**. `rm -rf lib` then `pnpm --filter @khorsheed/dsh-canvas build`, `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` all green.
- The CSS fix is verified by construction (the class now resolves in the module the switcher imports) — a visual pass on 3080 stays with the deploy flow.

## Deferred

- A systematic "class's owner imports the module that defines it" sweep across the package (this was the only cross-module import of a component class).
- Session-side reach of v1 pad content, if ever wanted, belongs to M4's indexing design, not a resurrected one-shot copy.

## Related

- [M1 note](2026-09-16-canvas-space-m1.md) (the importV1 this removes).
- [M3 note](2026-09-16-canvas-rightbar-rework.md) (the tab this topbar belongs to).
- [M3.1 note](2026-09-17-canvas-m3-1.md) (the immediately previous topbar-era correction).
