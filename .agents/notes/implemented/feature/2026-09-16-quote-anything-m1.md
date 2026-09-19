# Agent Note: quote-anything M1 — the selection overlay, the composer insert path, and the thin `quote` Remote

Status: implemented

English | [中文](2026-09-16-quote-anything-m1.zh.md)

## Problem

The [quote-anything proposal](../../../proposals/active/2026-09-16-quote-anything.md) wants "select any text anywhere → floating menu → quote it somewhere" as the reference layer of the inspiration trio (canvas + side-chat + quote). Three questions had to be answered with contracts, not taste:

**Is there an official selection seam?** No — the side-chat M2 probe settled this: nothing in the `conversation.*` SlotMap catalog addresses text spans, every "selection" in ui-conversation is composer-input machinery, and message-tools has no selection feature. The proposal therefore sanctions `window.getSelection()` as the last-resort DOM anchor — with a mandatory fallback.

**What is the honest composer insert API?** The proposal named the direction (`ctx.sessions.scope(id).get('conversation')`) and demanded the exact API be verified against the host contract.

**Can the browser queue a side-chat ref without a fork?** `ctx.sideChat.openWith` is a HOST service. The task allowed reaching side-chat through its Remote namespace if — and only if — a fitting verb exists.

## Decision

**The selection read is one small injectable seam, and its fallback is silent disappearance.** `src/client/selection.ts` folds the whole DOM anchor into `SelectionSource` (`start(listener)` → teardown): the real implementation listens to `selectionchange` (suspended mid-drag, evaluated on a 0ms timer at mouseup, 120ms-debounced for keyboard selection) and hides on any scroll/resize (the cached viewport rect is stale). Classification is a pure function: non-collapsed, non-blank text, anchor AND focus outside `input, textarea, [contenteditable]:not([contenteditable="false"])`, and outside the menu's own attached root. It reads ONLY the selection's plain text and its range rect — no host DOM structure, no class names; the editable exclusion is the one structural judgment the gesture itself requires, and the `evaluate` call is wrapped so a throwing anchor read degrades to "menu never shows", never to a boot failure. Component tests drive a manual source and never touch the real window selection; the real source's own jsdom spec stubs only jsdom's missing range geometry.

**The menu is one root-scope `shell.overlay` entry whose actions never race the live selection.** Text and rect are captured at selection time. Clicking an action closes the menu and marks that snapshot consumed: the click's own mouseup makes the source re-report the still-intact selection, and that single echo (same text + same rect) is ignored — the next distinct selection re-arms. Route items follow the degrade matrix: no current session → both quote items hide (copy stays); `remote.quote` or `remote.sidechat` absent → the side-chat item hides; a click that still races a missing service gets the verb's `unavailable` refusal and no-ops silently. The menu is a focus-free `role="toolbar"` card styled on the official Menu's tokens (buttons preventDefault their mousedown so the selection survives the click).

**Insert API found: `input.setDraft(merged)` over the scope-addressed input machine — the message-tools backfill precedent.** Verified against the host contract (`ui-conversation/src/client/contract/input.ts`): the scope-addressed `conversation.input.for(scope)` facade exposes `setDraft` (whole-draft programmatic write) and `state.getSnapshot().draft`; the span-CAS'd `insertReference`/`slash/input-insert-text` paths exist but serve trigger-token replacement, not arbitrary insertion. So the route reads the live draft and writes `mergedQuoteDraft(draft, block)` — blank draft filled directly, typed draft appended after one blank line, never overwritten, never sent (the proposal's "formatted `> quote` block" fallback IS the primary path; there is no richer insert verb to prefer). The block is `formatQuoteBlock`: every line `> `-prefixed, the localized attribution closing the same blockquote. Source label = the current session's display title, generic「选区」fallback — best-effort, plain text, no link back to the origin (v1 has no anchor seam).

**The side-chat route ships this package's own thin typert Remote — no fitting verb exists on `remote.sidechat`.** The audit: `send` starts a whole agent turn (and refuses empty text), `quoteMessage` addresses an assistant message by id — neither queues an arbitrary-text PENDING ref. So the `quote` namespace carries one verb, `addRef({contextKey, label?, ref})`, whose host half probes `ctx.get('sideChat')` (a structural mirror — the sidechat package is never imported; the edge is declared in `dsh.references`) and calls `openWith`, the sanctioned host-to-host seam canvas already rides. The verb takes no calling agent: `openWith` owns no session-scoped write, and the side-chat store fences host-side calls on the deployment default mode (the canvas `askAgent` precedent). Outcomes are explicit: `unavailable` (no side-chat), `empty` (blank key/text), `io` (the seam threw). On success the client surfaces the side-chat tab through the official `sidebarRight.openTab('sidechat', {params: {contextKey}})` navigation face — also a structural mirror, probed, silent without the seat.

## Alternatives considered

### Why not client-only (no Remote at all)?

The task preferred client-only "if feasible". It is not: the side-chat context map is host state behind a host service, and the only browser-reachable faces are Remote namespaces. `remote.sidechat` has no refs verb (audited above), so client-only would mean dropping the「引用到侧边对话」route — half the proposal. The thin Remote is the smallest honest bridge: one verb, zero state of its own.

### Why not call `remote.sidechat.send` with the quote as the text?

That SENDS a message and spins up the side agent — the gesture becomes "ask the side chat about this" instead of "file this as a pending ref I can write around", contradicting the proposal's form column (ref chip above the composer). It would also burn a model turn on every quote.

### Why not a `status()` verb for the side-chat item's visibility (the canvas `chatStatus` precedent)?

Canvas needed the honest host-side answer because its chat entries persist on screen. Our menu is transient — it re-renders on every selection, so a cheap synchronous probe (`ctx.get('remote.sidechat')` presence = side-chat's client half loaded, plus our own `remote.quote`) re-evaluated per open is accurate enough, and a click that races the residual gap (side-chat client present, host service gone) still lands on `addRef`'s `unavailable` refusal. A second verb would be wire surface without a consumer.

### Why not the span-CAS insert events (`slash/input-insert-text`) for the composer?

They exist to replace a trigger token span adjudicated by the input shell; constructing a synthetic span at the draft end rides internal coordinate semantics ("detect-projection coordinates") that the public facade deliberately hides. `setDraft` is the documented programmatic write — the same one message-tools' withdrawal backfill and the persisted-draft seed use.

### Why not keep the menu open with a confirmation after 复制/引用?

Chrome without a contract. The close IS the confirmation for the two quote routes (the composer visibly changes; the side-chat tab surfaces), and copy keeps the pattern minimal in v1. Recorded here so a later polish pass knows it was considered, not forgotten.

## Consequences

- New package `packages/quote` (`@khorsheed/dsh-quote` 0.1.0): host half = `src/remote.ts` (the `quote` namespace, one verb) + `src/index.ts` (bare mount, no injects) + `src/invariant.ts`; client half = `src/client/{index,contract,locales,selection,SelectionMenu.tsx,SelectionMenu.module.css}`; shared vocabulary in `src/types.ts`. Registered in `scripts/gen-typert.mts`'s `TYPERT_PACKAGES`; `docs/packages.md` regenerated (35 packages).
- `dsh.references: ['@khorsheed/dsh-sidechat']` declares the one cross-plugin edge as data; `pnpm check:plugins` passes unmodified (the checker honors `dsh.references`, so the feared flag never materialized).
- The upstream ask is drafted at `docs/upstream-proposals/2026-09-16-selection-actions.md` (selection-actions seam in ui-conversation + document preview, owner props carrying plain text + optional anchors), and the DOM-anchor path's retirement is keyed to it.
- One jsdom lesson worth restating: jsdom's `Range` has no `getBoundingClientRect` — the seam's own spec stubs range geometry; production behavior on a throwing anchor read is the catch-to-null fallback (silent disappearance), not a zero-rect menu.

## Testing

- `packages/quote`: **32 tests green** — `tests/types.spec.ts` (4: the quote block + the draft merge), `tests/remote.spec.ts` (5: the `addRef` degrade matrix — `unavailable`/`empty`/`io`, label defaulting, the exact `openWith` payload), `tests/selection.spec.ts` (11: classification exclusions + the source's drag/debounce/scroll/teardown wiring), `tests/client.spec.tsx` (12: the visibility degrade matrix, all three routes, the consumed echo, the label fallback).
- `pnpm --filter @khorsheed/dsh-quote build` (gen-typert → tsc → tsdown), `pnpm check:plugins`, `pnpm check:hygiene`, and `pnpm test:scripts` are green; `docs/packages.md` regenerated.
- NOT done: a live-browser walk of the real 3080 instance (the acceptance gate's item 3 — selection in the chat area → menu → composer → send; canvas detail → side-chat ref chip; side-chat uninstalled → only the conversation item). jsdom covers wiring and degrade logic, not real selection UX.

## Deferred

- M2 per the proposal: accumulating multiple quotes, inline quote-block expansion, area-by-area DOM-anchor retirement as the upstream seam lands.
- Menu polish: keyboard navigation, scroll-following instead of hide-on-scroll, a copy confirmation.

## Related

- [side-chat M2](2026-09-16-side-chat-m2.md) (the selection-seam probe conclusion this M1 builds on, and the floating-dock overlay precedent).
- [side-chat M1](2026-09-16-side-chat-m1.md) (the `openWith` seam and the pending-ref model the route queues into).
- [quote-anything proposal](../../../proposals/active/2026-09-16-quote-anything.md) (the M1 row and its acceptance criteria).
