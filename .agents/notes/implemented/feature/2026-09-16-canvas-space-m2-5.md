# Agent Note: canvas M2.5 — the card detail moves in-space, because the right Sidebar never renders there

Status: implemented

English | [中文](2026-09-16-canvas-space-m2-5.zh.md)

## Problem

On 3080, clicking a card body in the canvas space produced **no feedback at all**. The M1.5 design put the card-detail reader in the right-Sidebar canvas tab and activated it via `ctx.sidebarRight.openTab('canvas')` ([M1.5 note](2026-09-16-canvas-space-m1-5.md)). The host source proves this can never work inside the space: `RightbarRoot.tsx` renders the right Sidebar only while the CONVERSATION panel is active (`usePanelInfo(info => info.activePanelId === null)`, otherwise `return null`). The canvas space IS a custom main panel (`activePanelId === 'canvas'`), so the right Sidebar is invisible there by construction — the detail tab and the programmatic activation were both dead affordances in exactly the surface they served. (M2's proposal-era risk note had already flagged "右栏在自定义 main 面板激活时的表现" as a probe item; the probe verdict arrived through use.)

## Decision

**The detail reader moves into the space as a third column — same component, same store.** `CanvasSpacePage` is now 画布列表 | 卡板 | 详情 pane, and the pane renders `CanvasDetailView` — the M1.5 reader, which was already driven by the shared selection store and is therefore seat-agnostic. A body click still writes the store (`selectCard`); the page expands the pane on selection. The programmatic `openTab('canvas')` activation is **removed, not downgraded**: it can only ever fire inside the canvas panel, where it is a guaranteed silent no-op — a best-effort call with no live scene is dead code.

**The pane folds and remembers.** It collapses to a 28px rail (expand affordance) and remembers the fold in `localStorage` (`canvas.detailPane`) — a preference, read best-effort, defaulting open. An existing selection always wins the pane: returning to the space with a card selected re-opens it (the fold only decides the no-selection default).

**The reader supports a session-less pane (root scope).** `CanvasDetailProps.sessionId` is now optional; with none (no current session) the reader is read-only — edit toggle, ghost ✓/✗, restore, the comment form, and 问 Agent all hide (mutations and asks fence through a session, and there is none to borrow). The right-Sidebar seat passes its own session as before.

**The right-Sidebar tab registration stays, and consistency is free.** The keyed `sidebar.right.pane.tab` seat and the tab type remain registered for the conversation scene (the rail-side surface a future session-side reference could open). Both seats read and write the ONE selection store — the pane and the tab can never disagree (the M1.5 rev channel re-reads both on either seat's mutation).

**Chat keeps its current shape; side-chat M3 owns the in-space reveal.** 问 Agent in the pane still primes and sends through `askAgent` and still calls `openTab('sidechat', …)` inside try/catch — equally a no-op inside the space by the same RightbarRoot contract. side-chat M3 builds its own floating dock for custom panels; canvas waits for that seam rather than growing a dock of its own.

## Alternatives considered

### Why not make the host render the right Sidebar for custom panels (an upstream change)?

The repo's rule is that canvas never forks the host: the RightbarRoot gate is a deliberate contract (the right column belongs to a session's context, and a global panel has none). A proposal to widen it may yet be right for side-chat M3's dock — but that is upstream's seam to offer, tracked there, not something canvas patches around today. The in-space pane is the plugin-pure answer and it is strictly better UX (detail beside the board, not a viewport away).

### Why not drop the right-Sidebar tab registration entirely?

It is the same component fed by the same store, and it works in the conversation scene — a session-side jump-to-detail (M4's `canvas_search`/`canvas_clip` territory) is exactly the path that would open it. Removing it would be deleting a working surface to honor the broken one; the contract stays, documented as conversation-scene-only.

### Why not keep `selectCard`'s `openTab('canvas')` as a try/catch best effort?

Try/catch hides failures, but this call does not fail — it lands, activates a tab inside a column that never renders, and reports nothing. A no-op with a 100% rate is not a fallback, it is a lie the code tells. The honest sentence is the one now in `index.ts`'s comment: the reveal belongs to the pane; the tab is for the conversation scene.

## Consequences

- `packages/canvas/src/client/space/CanvasSpacePage.tsx`: three-column layout; pane state with `localStorage` fold memory and expand-on-selection; renders `CanvasDetailView` via `{...props}`.
- `packages/canvas/src/client/space/CanvasSpacePage.module.css`: `data-pane` grid variants (340px pane / 28px rail), `paneBar`, `paneRail`.
- `packages/canvas/src/client/detail/CanvasDetailView.tsx`: optional `sessionId` with the full read-only mode; the mutation helper narrows the session for every call site.
- `packages/canvas/src/client/index.ts`: `activateDetailTab` deleted; `selectCard` is a pure store write; `openFile` shared by both faces (documented as a no-op inside the space by construction).
- `packages/canvas/src/client/contract.ts`: `CanvasSpaceInjected` gains `openFile`; `CanvasDetailProps.sessionId` optional.
- locales: `pane.collapse` / `pane.expand`. Version 0.3.1 → 0.3.2.
- No Remote, service, store, or wire change; the right-Sidebar registration and the whole M2 chat path are untouched.
- The M1.5 note's "activate the detail tab through the official openTab" decision is superseded by this one; the two notes are cross-linked.

## Testing

- `packages/canvas`: **160 tests green** (158 before): the space spec gains the two pane cases — a body click renders the full card in the pane (the empty state yields), and the fold persists across a remount (with a fresh store, as a real reload has) while re-expanding on demand; the harness now drives a REAL `CanvasSelectionStore` for every test (the pane follows the production channel, not a mock). The detail spec is untouched and stays green (the session-scoped seat is unchanged).
- `rm -rf lib` then `pnpm --filter @khorsheed/dsh-canvas build`, `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` all green.
- NOT re-verified on 3080 (deploys stay coordinated); the jsdom specs cover the pane's open/render/fold and the RightbarRoot contract is cited from host source.

## Deferred

- side-chat's in-space reveal (its floating dock for custom panels) is side-chat M3's own seam — canvas keeps the try/catch `openTab('sidechat')` and waits for it.
- A host-level "right Sidebar for global panels" contract, if ever wanted, is an upstream proposal (noted in the seam registry when it materializes).

## Related

- [M1.5 note](2026-09-16-canvas-space-m1-5.md) (the summary/detail split and the tab reader this supersedes).
- [M2 note](2026-09-16-canvas-space-m2.md) (the chat path the pane keeps).
- [canvas-space proposal](../../../proposals/active/2026-09-16-canvas-space.md) (§3 摘要与详情分工).
