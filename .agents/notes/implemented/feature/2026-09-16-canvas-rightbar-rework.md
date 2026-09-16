# Agent Note: canvas M3 — back to the right Sidebar, because the main-panel route was structurally dead

Status: implemented

English | [中文](2026-09-16-canvas-rightbar-rework.zh.md)

## Problem

The M1–M2.5 canvas lived as a custom main panel: a left-rail `sidebar.panellist` row, a keyed `main` space page, and (after M2.5) an in-space detail pane. On 3080 the user made the call to abandon that route and move the canvas back to the right Sidebar as a wide-mode tab — one of a three-piece set with side-chat and the quote plugin.

The structural evidence had been accumulating all along and was decisive: the host's `RightbarRoot.tsx` renders the right Sidebar ONLY while the conversation panel is active (`activePanelId === null`, else `return null`). A custom main panel (`activePanelId === 'canvas'`) therefore makes every right-Sidebar surface fail by construction — M1.5's detail tab and its `openTab` activation (dead, worked around by M2.5's in-space pane), M2's `openTab('sidechat')` reveals (equally dead in the space), and anything the three-piece set would want to show beside the conversation. The main-panel route didn't just cost an entry point; it amputated the whole right-Sidebar ecosystem the canvas was meant to join. Moving back is the answer isomorphic with the host's layout: the canvas lives beside the conversation, where "edit the canvas from the current session" is a zero-cost path.

Three design problems followed. **How wide should "wide mode" be, and who asserts it?** The presentation is ui-sidebar-right's own fact (its store reports `syncPresentation` to the frame), so a plugin forcing it every render would fight the user. **Where do the switcher/board/detail/draft live in one tab?** M1–M2.5's separate space page, in-space pane, and tab reader had to converge into one drill navigation without losing any component. **How does the main session's agent edit the canvas?** The side-chat `openWith` path only reaches the canvas's own side context; the current session needed its own entrance, gated so it can never edit blind.

## Decision

**The main-panel route is retired wholesale; the tab is the single seat.** Deleted: the `main` + `sidebar.panellist` registrations, the `CanvasSpacePage` space page and its spec, the in-space detail pane, and the `ui-sidebar` dependency (peer/dev/`dsh.client.inject`). What survives intact: the whole data model, the board service, every Remote verb, `BoardView`, `CanvasDetailView`, the selection store, the side-chat seam, the v1 import — the proposal's own §0.1 says so: 数据模型、host store、Remote、卡板/详情组件、openWith 集成、v1 导入全部沿用.

**The tab is a three-page drill with one topbar.** The topbar owns the canvas switcher dropdown (`tab/CanvasSwitcher.tsx`: create/switch/archive/the v1 import, ported from the retired space page's list column), the attach chips, the `[卡板|成稿]` view switch, and the new-card menu. The board page is the M1 `BoardView` unchanged in interaction (its old in-page topbar moved up). The detail page drills in on a body click and returns with a back button, reusing `CanvasDetailView` — now with the **render / source / split** tri-state instead of the read/edit toggle (`MarkdownText` full render, the v1 editor invariants for source editing via `patchCard`, split when the width allows). The draft page (`tab/DraftView.tsx`) is a REAL manuscript editor over the new `readDraft`/`writeDraft` verbs: `draft.md` beside `canvas.json`, the v1 pad editor's exact contract (uncontrolled textarea keyed by load token, IME composition as a hard stop for save AND preview, debounced auto-save behind the version guard, conflict stops instead of clobbering, one scroll container per pane). The open canvas and the drilled card ride the shared selection store, extended with `openCanvas`/`clearCard` for the drill semantics.

**Wide mode is a one-shot suggestion, never an assertion.** The audit pinned the mechanism: no per-tab presentation seam exists (the tab definition has no presentation field, `openTab` takes only placement+params, and the fullscreen dock mode is ui-sidebar-right's store-internal fact — its `syncPresentation` re-asserts on every shell state change). So the tab, on first visibility per session, SUGGESTS once through the probed layout face: `openRightbar(track, fullscreen)` — written before the shell's next sync, so it holds until the user's own control re-asserts (exactly "suggest, then hands off") — plus `toggleSidebar()`, gated on the frame's own `data-sidebar-collapsed` DOM marker so it never fires blind (a missing marker skips the toggle silently — the sanctioned DOM-last-resort-with-fallback). The dedupe is an apply-level per-session set, so remounts never re-force. The兜底 stands: the user can fullscreen by hand and the layout remembers; a programmatic "always wide" is an upstream seam candidate.

**The main session gets the two tools, focused and fenced.** `canvasMainSessionToolDefinitions` register through the profile-root `ctx.inject(['tools'])` (the datasets-tool deferred pattern, proven at root by capability-catalog), origin-tagged to `@khorsheed/dsh-canvas` via the documented no-import `Symbol.for('dsh.tool.origin')` path, with a `canvas:tools` prompt section. The target canvas resolves per call from `ctx.canvasBoard.focusedCanvasId(session)` — the canvas the right-Sidebar tab last reported open through the new `focusCanvas` verb (agent-first, an in-memory per-session map; a restart simply means "nothing open yet"). With no focus, the tools answer a plain "没有打开的画布" message instead of failing or guessing. Execution fences with `exec.agent.session` — the main session's own mode, same re-rooted fence as every other write. The side-chat `openWith` injection path is untouched: the user chooses the current session or the side one.

**The draft gets real storage, not a skeleton.** `readDraft` (an absent draft reads as empty with a null token) and `writeDraft` (null token creates via `createIfAbsent`; else `replaceIfVersion` — the manuscript is never silently overwritten), through the same re-rooted fence, so the draft view ships as a working editor rather than a mock with an M4 note.

## Alternatives considered

### Why not keep the main panel AND the right-Sidebar tab as two entrances?

Two entrances to one store was exactly M1–M2.5, and it is what broke: the main panel's surface could not host ANY right-Sidebar piece (detail, side-chat, quote). Keeping both means keeping a space that is structurally chat-blind beside one that is not, forever explaining to users why entries appear in one and not the other. The proposal's revised §1.1 says the seat is the tab; the space's unique value (a big page) is recovered by wide mode.

### Why not drive fullscreen through `openTab` params or a tab-definition presentation field?

Neither exists in the host contract — that was the first probe. `SidebarRightTabDefinition` carries identity/kind/patterns/priority/veto only; `openTab` options are placement plus navigation params. Adding such a seam is precisely the upstream candidate recorded below, not something to fake from a plugin.

### Why not call `openRightbar(track, fullscreen)` on every tab activation (until the user objects)?

That is fighting the shell for its own fact. ui-sidebar-right re-asserts `syncPresentation({shown, track, fullscreen})` from its store on every state change; a canvas re-asserting on every activation makes two writers racing over one boolean, and the user "wins" only by fighting both. One write, once, before the shell's next sync, is a suggestion; every further one is a fight.

### Why not have the main-session tools take an explicit `canvasId` parameter instead of the focus model?

An explicit id makes every call carry bookkeeping the model gets wrong (ids are opaque `canvas_…` strings the model must first list to learn), and silently invites editing a canvas the user is NOT looking at — the exact "edit blind" the gate exists to prevent. The focus model makes the natural reading the only reading: the tools edit what the user sees, and say so when there is nothing to see. A future `canvas_search` (M4) can add explicit-address tools deliberately.

### Why not leave `draft.md` to M4 with the proposal's full draft flow?

The proposal's §2 layout always had `draft.md` beside `canvas.json`, and the view without storage is a textarea that loses the user's words — a dishonest skeleton. The two verbs cost one version-guarded path (the board's own pattern) and make the view real today; the M4 candidate-diff flow builds on the same file untouched.

## Consequences

- Retired: `packages/canvas/src/client/space/CanvasSpacePage.tsx`, `src/client/space/definition.tsx`, `tests/space.client.spec.tsx`, the `main`/`sidebar.panellist` registrations, the in-space detail pane, and the `@deepseek-ai/dsh-client-ui-sidebar` dependency (peer/dev/`dsh.client.inject`).
- `packages/canvas/src/client/tab/` (new): `CanvasTab.tsx` (topbar + three pages + drill + focus reporting + the one-shot wide-mode suggestion), `CanvasSwitcher.tsx`, `DraftView.tsx`, `CanvasTab.module.css`.
- `packages/canvas/src/client/space/CanvasSpacePage.module.css` → `board.module.css` (space-page-only blocks removed); `BoardView` loses its in-page topbar and new-card menu (both moved to the tab's topbar); `selection.ts` gains `openCanvas`/`clearCard`.
- `packages/canvas/src/client/detail/CanvasDetailView.tsx`: the edit toggle becomes the render/source/split tri-state.
- `packages/canvas/src/store.ts`: `focusCanvas`/`focusedCanvasId`, `readDraft`/`writeDraft`. `packages/canvas/src/remote.ts`: the four verbs (focus agent-first, draft write agent-first, draft read agentless). `packages/canvas/src/tools.ts`: `canvasMainSessionToolDefinitions`. `packages/canvas/src/index.ts`: profile-root tools + the `canvas:tools` prompt section.
- `packages/canvas/src/client/index.ts`: single-seat registration, `suggestWideMode` (per-session dedupe, probed layout face, DOM-gated sidebar toggle), the focus-sync and watch plumbing unchanged.
- `package.json` 0.3.2 → 0.4.0 (a direction change, not an API break: every M2 verb is untouched).
- The M2.5 note's "the detail lives in the in-space pane" is superseded by this one (the detail lives in the tab's drill page); the two notes are cross-linked. The M1.5/M2 notes' shared-store and seam decisions all survive.
- On 3080 the canvas is beside the conversation again: the right-Sidebar tab opens the workbench, the main session's agent can edit it, and side-chat stays the second opinion.

## Testing

- `packages/canvas`: **168 tests green** (170 before the client swap): the retired space spec's 12 cases give way to `tab.client.spec.tsx`'s 15 (list → auto-open → board; switcher create/archive/import; topbar new-card with the IME hard stop; ghost accept/reject against a mutation-applying fake; checkbox multi-select + batch archive; lens → askAgent → openSideChat and the full-hide degrade; drill in/out; the tri-state source save; draft load + debounced guarded save; once-per-mount wide-mode suggestion; focus reporting on open/switch; read-only degrade). Host adds: focus/draft six, main-session tools three, remote four.
- `rm -rf lib` then `pnpm --filter @khorsheed/dsh-canvas build`, `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` all green.
- NOT re-verified on 3080 (deploys stay coordinated); the RightbarRoot contract is cited from host source, and the wide-mode suggestion's effects are covered at the face level.

## Deferred

- `canvas_propose_draft` + the candidate-diff banner, the remaining stats-driven rules, web search wiring (later M3); document-card html rendering (srcdoc inline + the `assets/` read verb), session-side `canvas_search`/`canvas_clip` and the "insert into current session" composer action (M4).
- A per-tab presentation seam (a definition- or navigation-level fullscreen request) — upstream candidate, would retire the DOM-gated suggestion.
- Paste-to-create, canvas renaming, attach-list editing after creation.

## Related

- [M2.5 note](2026-09-16-canvas-space-m2-5.md) (the in-space pane this supersedes — and the RightbarRoot root cause, twice confirmed).
- [M2 note](2026-09-16-canvas-space-m2.md) (the side-chat seam and the tools, both kept).
- [M1 note](2026-09-16-canvas-space-m1.md), [M1.5 note](2026-09-16-canvas-space-m1-5.md).
- [canvas-space proposal](../../../proposals/active/2026-09-16-canvas-space.md) (§0/§1/§3/§7 as rewritten for this direction).
