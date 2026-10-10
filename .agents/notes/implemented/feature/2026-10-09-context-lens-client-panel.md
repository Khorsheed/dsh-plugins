# Agent Note: context-lens client panel — the 请求明细 right-sidebar tab and its two entries

Status: implemented

## Problem

The M1 host capture (see [the host-capture note](2026-10-09-context-lens-host-capture.md)) puts every turn's requests on the `requestInspector` Remote, but nothing a user can open existed. The browser half had to port the approved interactive design (`scratch-context-lens/index.html`, real captured data inlined) onto the Remote verbs faithfully — including the parts the mock could not express (turn switching, live session identity, per-scope config) — while satisfying the panel-design spec (one width-adaptive layout, `--dsh-panel-*` type, `--dsw-alias-*` theme colors) and the visibility convention (session-bound content self-hides by preset composition).

## Decision

One right-sidebar page tab (`context-lens` kind, the worktrees two-stage registration: `sidebarRightTabs.register` for the type, the body under `sidebar.right.pane.tab` keyed by the package id) plus two entries opening it: the assistant message's action-row icon (`conversation.chat.assistant-actions`, resolving `messageId` → `turnSeq` via `TurnListItem.closingMessageId`, latest-turn fallback) and a session-header utility (`conversation.session.header.utilities`, latest turn). All three registrations ride the canvas-pattern `RegistrationToggle` over the preset-visibility probe — the criterion is this package's own row (root-mounted by the bundle patch → granted to every session; the preset path is checked too), every unreadable path fails open. Unlike canvas, the slot entries also toggle at registration level (the toggle wraps `ctx.slots.inject` directly — it returns a synchronous disposer).

The current UI inventory is specified in [Context Lens](2026-10-10-context-lens.md), which supersedes the first panel layout while retaining this registration and visibility contract.

- **Scroll-sync** (2026-10-10): switching the panel's turn — from the menu, from the action-row navigation params — scrolls the conversation to that turn over the DOM anchors `[data-conversation-scroll]` + `[data-chat-turn="<hostTurn>"]` (the exact row, else the nearest mounted turn ≥ it in DOM order, the host `scrollToTurnAtOrAfter` semantics), reduced-motion aware, every failure a silent no-op. No public API exists; the seam is registered as docs/upstream-seam-registry.md S20. The 最新 button bottoms the scrollport out instead (`scrollTo(scrollHeight)`, largest turn row as the anchor fallback).

`<details>`/`<summary>` rows are driven through controlled state (the summary's click is pre-empted): jsdom never performs the native toggle, and a re-render must never snap a user's fold back. State is React-local (no slot store): no surface outside the tab reads it. The sample page for the screenshot self-check lives in `scratch-ri-panel/` (gitignored).

## Alternatives considered

- **Whole-turn-only timing tab (the milestone brief's literal reading)**: the design's scope chips filter the timing view, and dropping that would strand the chips on one tab. Lanes carry everything the filter needs, so the per-scope view is exact rather than degraded; the successor specifies per-agent overlap and gap accounting.
- **A `defineStore` slot store (the worktrees pattern)**: rejected — the store exists so the badge/title share tab state; nothing outside this tab reads the inspector's selection, and React-local state keeps the component directly testable with composed props.
- **Keeping the native `<select>` for the turn switcher** (the first cut): rejected on review — it renders the OS chrome, not the product's; the host `Menu` gives the keyboard walk, dismissal, and focus return for free and carries two-line rows (title + count/tokens) a `<option>` cannot.
- **Rendering `ToolTiming.tools` for the per-tool section**: the host aggregate has no `scopeId` and no per-bucket split, so a scope-filtered timing tab could not use it; the lane-derived rows (calls · argsMs · execMs) are what ships. The successor allocates reasoning to calls; waits and text remain in the non-tool table.
- **`remote.pluginInventory` in `inject`**: rejected per the visibility doc — a host without the namespace would pend the whole client; the probe goes through `ctx.get` and fails open.

## Consequences

- The token tab defaults to a scope's FIRST request (the design's `selected = 0`), not the last; the ＝弹层 marker from the mock is gone with the mock's chat column.
- Contract gaps found while porting (reported, types unchanged): `responseSummary` hardcodes「直接回答」host-side (store.ts `summarizeResponse`), so the anchor and card titles stay Chinese under the English locale; `AgentScopeOverview` carries no delegation-run seq, so a failed 0-request run's chip has no `#seq`; `ToolTiming` is whole-turn-only (worked around via lanes); `TurnTiming.buckets.otherMs` excludes inter-request gaps (the panel folds them in).
- The package still lacks `README.md` / `README.zh.md` with the Compatibility section — required by the npm pre-publish checklist, deferred to the publish milestone.
- The M1 note's two deferred gate failures are closed here: `check:panels` passes (PanelRoot + container queries + palette exemptions), and `docs/packages.md` lists the package (regenerated).

## Testing

`tests/client-panel.spec.tsx` drives the tab body with composed-props fakes: mount → listTurns → getTurn → getRequest, the turn switcher, navigation params, scope chips (failed-run page, honest child-lane empties), the legend filter, row expansion (verbatim + assistant unfolding + tools grid), the timing tab (buckets, per-tool, call-row click-through, scope filter), the request-local JSON toggle, and the empty/error states. `tests/client-aggregate.spec.ts` pins the pure layer (turn resolution, category aggregation, lane reduction with gap folding and scope filters, formatters). `tests/client-actions.spec.tsx` covers both entries; `tests/client-preset-visibility.spec.ts` covers the criterion's grant paths and every fail-open path plus the toggle. The screenshot self-check ran on the sample page (390px light/dark + 800px, no horizontal overflow).
