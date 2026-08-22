# Agent Note: taskpilot job drawer pushes the conversation column aside

Status: implemented

[English](2026-08-22-taskpilot-drawer-push-layout.md) | 中文

## Problem

The job detail drawer is a fixed right overlay (`position: fixed`, 520px). While
open it covered the right edge of the conversation: chat messages and the
composer's right side sat underneath it. Users testing the drawer asked for the
chat area and composer to shift left instead.

## Decision

While the drawer is open it now claims its width from the layout: the component
sets a document mark (`html[data-taskpilot-drawer-open]`) and a width variable
(`--dsh-taskpilot-drawer-w`) while open, and a global rule pushes the
conversation column's scroll region left by that width
(`[data-slot='conversation'] [data-conversation-scroll] { margin-right: … }`).
The composer seat renders inside the scroll region, so chat and composer move
together. The claimed inset is responsive: `computeDrawerInset` returns the
drawer width (520px, capped at the viewport) only when at least 640px of
conversation column would remain; narrower viewports set 0 and the drawer
overlays as before. The inset recalculates on window resize, and the mark and
variable are removed on close/unmount.

This mirrors the sibling ui-file-preview drawer's established push pattern
(document mark + width variable + conversation-scroll margin), with the added
narrow-viewport fallback that sibling lacks.

## Alternatives considered

- **Render into the product's details column** — rejected: the `details` slot
  is `single` and occupied by the official DetailsPanel; registering there
  would replace it, and driving its width would open the official panel, not
  the drawer.
- **Padding on `#root` / `body`** — rejected: shifts the whole frame globally
  and fights the product's own layout ownership; the conversation-scroll margin
  is the sibling-proven, locally scoped push.
- **Push unconditionally, like ui-file-preview** — rejected: on narrow
  viewports a 520px (or full-width) margin hides the chat entirely; the
  responsive inset keeps an overlay fallback.

## Consequences

- The drawer no longer hides the right edge of chat or composer on wide
  viewports; narrow viewports keep the previous overlay behavior.
- No product files touched: the mark, variable, and push rule are all owned by
  the taskpilot bundle; if the target selectors ever stop matching, the drawer
  simply overlays (the variable defaults to 0px).
- When both the taskpilot and ui-file-preview drawers are open at once, both
  write the same `margin-right` on the same element and the later stylesheet
  wins — a pre-existing sibling conflict, not introduced here.
