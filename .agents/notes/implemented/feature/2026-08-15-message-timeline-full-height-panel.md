# Agent Note: Full-height timeline panel for the message rail

Status: implemented

English | [中文](2026-08-15-message-timeline-full-height-panel.zh.md)

## Problem

The message-timeline rail (`packages/client/message-timeline`) revealed its message list as a small hover card capped by `previewMaxWidth`/`previewMaxHeight` (360×320 by default), vertically centered next to the dot rail, so long conversations forced scrolling inside a small box. The card's own scroller also had no load-older trigger: paging only worked on the dot track, which is not the surface the reader scrolls. Meanwhile the store kept a `selectedKey` duplicating what the rail tracker already publishes as `activeKey` (the visible reading position) — a value the component never read.

## Decision

Hovering the rail opens a full-height timeline panel anchored at the rail's measured box: one row per loaded user message, a tick plus an ellipsized one-line preview, styled on the shared `--dsw-*` tokens. (The dot rail was removed shortly after and the panel became the single always-on surface; see [the flat-list note](2026-08-15-message-timeline-flat-list.md). The pagination and highlight-derivation decisions below still stand.) The highlight model collapses to one derivation — `focusKey` (hover or arrow preselection), then the tracker's `activeKey`, then the latest message — so the store keeps only `open` and `selectedKey`/`setSelected` are gone. Clicking a row or dot jumps; the jump's programmatic scroll makes the tracker republish `activeKey`, settling the highlight on the jumped message with no stored state. The panel positions itself at the reading position each time it opens and leaves the scroll to the user afterwards. Pagination is preserved and extended: the dot track and the panel share one scroll-to-top `loadOlder` trigger, so the surface the reader actually scrolls now pages. Config replaces `previewMaxWidth`/`previewMaxHeight` with `panelWidth` (panel height is the rail height), and the unused locale keys (`rail.loadOlder`, `rail.toTop`, `rail.toBottom`, `rail.previewLabel`) are removed.

## Alternatives considered

**Keep the card, enlarge or uncap it.** Rejected: any fixed cap still boxes long conversations, and the tracker already measures the exact available height, so a full-height panel is simpler than another tunable.

**Replace the dot rail with the panel.** Rejected at the time: the collapsed dots give a density and position overview at zero hover cost. Later adopted by [the flat-list note](2026-08-15-message-timeline-flat-list.md), which owns the current interaction.

**Keep `selectedKey` for cross-remount persistence.** Rejected: the tracker republishes the reading position on the scroll event a jump causes, so a persisted selection buys nothing and can disagree with the live position.

**Virtualize the panel rows.** Deferred as unnecessary: rows are one-line buttons, even a few hundred loaded messages render cheaply, and paging bounds the growth.

## Consequences

One hover shows every loaded message at once, and history paging happens on the surface the reader scrolls. The component drops a store channel and the config drops a tunable; cordis.yml entries carrying `previewMaxWidth`/`previewMaxHeight` are now unknown fields (pre-release stance: no compatibility shim). Coverage: the component spec drives hover, keyboard, jump, and paging through the panel; the store, config, and apply specs pin the slimmed shapes.
