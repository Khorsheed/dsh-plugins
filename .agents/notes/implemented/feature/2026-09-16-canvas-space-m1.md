# Agent Note: the canvas space M1 — deployment-level board state and the re-rooted sandbox fence

Status: implemented

English | [中文](2026-09-16-canvas-space-m1.zh.md)

## Problem

The v2 redesign ([canvas-space proposal](../../../proposals/active/2026-09-16-canvas-space.md)) turns the inspiration canvas from a right-Sidebar pad into a **topic canvas space at workspace level**: a full-page card board reached from the left rail, where one canvas is one topic — a deployment-level entity that no single workspace may own. M1 delivers the space and the board: mounting, the data model, the Remote verbs, the card-board UI, and the v1 pad's one-shot import.

Two hard problems shaped the milestone, and both are recorded here because the code alone cannot carry the *why*.

**Where does board state live, and can the sandbox fence reach it?** The v1 pad lives inside the session's workspace, so its fence (`ctx.sandboxPolicy.resolve({ session })` → boundary = the session's cwd) works by construction. The v2 board deliberately lives at `$DSH_HOME/state/canvas/<canvasId>/canvas.json` — *outside* every workspace. The proposal's own risk ④ made this M1's first probe: does the v1 fence address the state dir, and if not, what writes there without ever bypassing the fence with bare `node:fs`?

**How does a root-scope page fence its writes?** The space mounts on the keyed root `main` panel, which binds no session. Every mutating Remote verb still takes the calling agent first (the wire convention the fence hangs on) — so which session fences a board write, and what happens when none is selected?

## Decision

**The space mounts as one id in two seats, both probed.** `ctx.slots.inject('main', …)` registers the full-page panel under `key: 'canvas'`; `ctx.slots.inject('sidebar.panellist', …)` registers the rail row with the same id at `order: 100` (the ui-sidebar shell matches panellist ids to main keys; it owns the row button and active state, the plugin supplies icon + label). `slots.inject` — never a bare `slots.register` — makes the degrade free: a host declaring neither seat simply never mounts the space, and the v1 right-Sidebar tab keeps working. The panel id is the package's loader entry id (`canvas`), extending the identity triangle to the panel.

**State-dir probe outcome: the v1 session fence CANNOT address the state dir; the fence is re-rooted, never bypassed.** The audit trail: `SandboxPolicyService.resolve({ session })` always sets `workspaceRoot` to the session's cwd; `fs-sandbox`'s `checkedTarget` confines `workspace-write` writes to `writableRoots(policy)` = that root plus platform temp dirs; the stock base bundle pins `mode: workspace-write` with fallback root `process.cwd()`. Therefore a session-stamped write to `$DSH_HOME/state/…` is `FS_SANDBOX_DENIED` by construction on every standard deployment. The chosen path keeps the mounted `ctx.fs` (version-guarded, atomic writes, the observation trail) and re-roots the fence **at the plugin's own state dir**: the calling session still resolves the **mode** — a `read-only` deployment still denies every board write — and still lends its `sessionId` to the write, while the `workspace-write` boundary becomes `$DSH_HOME/state/canvas`. That is a narrower fence than the session's own (one directory, not a workspace), keeps the agent-first wire convention meaningful (whose mode, whose id), and uses no bare `node:fs` anywhere. The state root itself follows the datasets `defaults.ts` precedent: an explicit `stateRoot` config wins, then `$DSH_HOME/state/canvas`, then `<cwd>/.dsh-canvas`.

**The board is ONE version-guarded document.** `canvas.json` holds metadata + every card + the counters (cards are small by design), so `CanvasBoardService` (`ctx.canvasBoard`) mutates by read → pure edit → `replaceIfVersion` write, re-reading and re-applying **exactly once** on a stale version — two browser tabs never silently lose each other's cards, and nothing is ever overwritten unconditionally. A corrupt file or one whose id does not match its directory is refused (`io`), never clobbered; the list skips it. The tolerant reader (`normalizeBoard`) drops malformed cards and defaults missing fields, the pad index's rule scaled up.

**Eight new Remote verbs; the v1 five are untouched.** `listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `importV1`. Mutating verbs keep the agent-first convention (whose session resolves the mode and stamps the id); reads take no agent. The page passes the **currently selected session** (`useSessions(s => s.current)`): with no session selected the space is read-only — boards still browse, every mutating control hides. `stats.proposed` counts ghost verdicts (proposed → kept is accepted, → archived is rejected) for M3's self-tuning rules; an agent comment moves an open question card to `exploring` (the §4 rule, implemented now because it is service logic), while `answered` stays user-settled only.

**The v1 import is a read-only copy through the pad service itself.** `importV1` lists and reads the pad through `ctx.canvasStore` (reads carry no fence), maps v1 卡片 → fragment cards and v1 文章 → document cards with the source's absolute path on each card, attaches the source workspace, and writes the new canvas in one `createIfAbsent` write. The pad's already-archived items stay behind (they were hidden there too); the pad itself is never written.

**M1's UI is the storyboard, minus later milestones.** Left canvas-list column (create with workspace attach multi-select / switch / archive well / import flow), board topbar (topic + read-only attach chips), kind filter chips, card grid, inline text editing (the v1 three invariants: uncontrolled textarea, IME composition as a hard stop, one scroll container), multi-select with batch archive, the archived well, ghost proposal cards (dashed, ✓收下 / ✗拒绝 wired to `patchCard` status transitions), question-state display with mark-answered, and comment threads. Kind is told by icon + words only; every colour is a `--dsw-*` token; official icon set throughout.

## Alternatives considered

### Why not stamp the v1 session fence unchanged and let the writes be denied?

That is "the fence works, the feature doesn't": on the stock `workspace-write` deployment every board write would fail with `denied`, and the space would be read-only everywhere. The fence exists to keep writes inside authorized territory — and the plugin's own state dir IS authorized territory for this plugin (the operator opted in by installing it, exactly like datasets' bindings and the harness's own `state/`). Re-rooting keeps the fence's shape (mode checked, boundary confined, session stamped); only the boundary's address changes, to the one directory the plugin owns.

### Why not bare `node:fs` for `canvas.json`, the way datasets writes its bindings?

Datasets' `binding.ts` is the state-dir precedent for *resolution* (`$DSH_HOME/state/<pkg>/` with the `process.cwd()` fallback), and its bare-fs writes are acceptable there because session bindings are small plugin bookkeeping. Board mutations are different: they are session-stamped content writes that race (two tabs, a tool call beside the operator), and `ctx.fs` buys them version guards, atomic publication, the observation-policy trail, and the `read-only` deployment's denial — all of which bare fs forfeits. The standing rule "never bypass the sandbox fence with bare `node:fs` for session-stamped content writes" settles it: `node:fs` appears nowhere in `store.ts`.

### Why not `sandboxPolicy.resolve({})` with no session (the deployment fallback root)?

The fallback root is the host's `process.cwd()`, which may or may not contain `$DSH_HOME` — writable by accident on some deployments, denied on others, and never stamped with the caller's session id. Re-rooting is deterministic on every deployment and keeps the audit trail (whose mode, whose id).

### Why not a per-card file layout (like the pad) instead of one `canvas.json`?

Cards are small and many, and the board's mutations are mostly whole-board gestures (reorder, counts, batch archive); one document makes the version guard meaningful (a stale write is detectable) instead of scattering it across N files. The proposal's §2 already reserves `draft.md` and `assets/` for the big things (M4); `canvas.json` is for the many small ones.

### Why not pass the canvas's attached workspace's session for the fence, instead of the current session?

The fence needs a *mode* and an *id*, not a workspace — and the current session is the session the operator is actually acting in, which is exactly what the v1 convention means by "the session that owns the gesture". An attached workspace may have no live session at all.

## Consequences

- `packages/canvas/src/types.ts` gains the v2 vocabulary: five card kinds, the status and question-state machines, the `canvas.json` shape with its tolerant reader, id rules (`canvas_`/`c_`/`m_` + time-ordered base36 — the state dir lists chronologically), `stats` counters and the list-row projection, and the eight verbs' wire payloads. The v1 vocabulary is untouched.
- `packages/canvas/src/store.ts` (new): `CanvasBoardService` + `resolveCanvasStateRoot` + `CanvasBoardConfig.stateRoot`.
- `packages/canvas/src/remote.ts`: the eight verbs; `static inject` gains `canvasBoard`.
- `packages/canvas/src/index.ts`: provides `canvasBoard` and forwards an optional `{ stateRoot }` plugin config.
- `packages/canvas/src/client/space/` (new): `CanvasSpacePage.tsx`, `BoardView.tsx`, `definition.tsx` (panel id + rail icon), `CanvasSpacePage.module.css`.
- `packages/canvas/src/client/index.ts`: the two probed registrations; exports the space pieces. `contract.ts` gains `CanvasSpaceInjected` / `CanvasSpacePageProps`; `locales.ts` gains the space keys in both dictionaries.
- `package.json` 0.1.0-rc.1 → 0.2.0 (the v2 line), new peerDeps `@deepseek-ai/dsh-client-ui-layout` / `-ui-sidebar` / `-ui-workspace` (wide ranges, all optional), `dsh.client.inject` extended to match, `dsh.compat.notes` records the space seats and the re-rooted fence. New devDeps `@testing-library/react` + `jsdom` (the worktrees/taskpilot client-spec pattern). No new runtime dependencies.
- One convention interpretation other packages may cite: **deployment-level plugin state re-roots the sandbox fence at the plugin's state dir** (mode and session id from the calling session; boundary = the state root; `ctx.fs` always, bare `node:fs` never). If a second package needs deployment state, follow `store.ts`, not datasets' `binding.ts`.
- The plugin-independence and hygiene checkers pass unchanged; the identity triangle is untouched (loader id `canvas`, `clientBundle('@khorsheed/dsh-canvas')`, `PACKAGE_NAME`).

## Testing

- `packages/canvas`: **115 tests green** (61 before M1): `tests/board.spec.ts` (24 — CRUD, ordering, archive-restore, import, the stale re-apply, the traversal guard, and the re-rooted fence: boundary = state root, mode preserved, read-only denied), `tests/board-vocab.spec.ts` (18 — the tolerant reader, id/title rules, counters), `tests/remote.spec.ts` (+2 — agent-first on the new verbs), `tests/space.client.spec.tsx` (10 — mount chain, create/attach, draft-card with the IME hard stop, ghost accept/reject, batch archive, mark-answered, read-only degrade, import probe → import, kind filter, well restore).
- `pnpm --filter @khorsheed/dsh-canvas build` (gen-typert → tsc → tsdown), `pnpm check:hygiene -- packages/canvas`, and `pnpm check:plugins` are green.
- NOT done: a live-browser walk of the real instance (no profile restart from this worktree); the jsdom specs cover the wiring, the visual match to the storyboard is by construction (same tokens, same geometry).

## Deferred

- Chat dock + per-canvas agent session (M2), the three model tools + stats-driven rules incl. card re-ordering/fading (M3), draft view + document-card rendering + session-side `canvas_search`/`canvas_clip` + v1 right-Sidebar removal (M4), the ui-workspace section seam (M5).
- Paste-to-create cards, canvas renaming, attach-list editing after creation, `沉淀为依据` from an answered question (needs answer content), board polling for external changes (mutations already re-apply once on stale; the page refreshes on its own gestures only).

## Related

- [canvas-space proposal](../../../proposals/active/2026-09-16-canvas-space.md) (M1 scope, the schema, the risk-④ probe requirement).
- [v1 inspiration-canvas proposal](../../../proposals/active/2026-09-13-inspiration-canvas.md) (the pad this builds beside).
