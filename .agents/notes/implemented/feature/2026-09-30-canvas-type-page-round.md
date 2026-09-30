# Agent Note: Canvas 0.6.0 — the one-page type page, the category page, the board as a table, the propose-type row

Status: implemented

## Problem

The first use of P1a (`2026-09-30-canvas-card-types-p1a.md`) turned up five problems:

- The type page read as three numbered steps, although a first visit and a later redesign are the same task.
- Category management was a panel over the board. With card types every row grew a style column and a 设计 door, and the panel was too narrow for them.
- The board looked flat: low-contrast chips, cards the same colour as the ground, and headed notes showing a literal `#`.
- After the agent proposed a type, nothing in the conversation led to the page where the user decides.
- The type had no memory of why it changed.

## Decision

**The type page as one page** (8f6acd92, with the log from 5182a233). Top to bottom:

1. The pending proposal, only when there is one. It shows this round's request, the face, the field table, what adopting does to the existing cards, and 采用 / 不采用.
2. 「现在的样子」.
3. 「卡片样式需求」. This holds the brief, the design button (「重新设计」 once a definition exists) and the revision log: one row per adoption, linking back to its session.
4. The kind's cards, all drawn with the one face. A card with empty fields lets its body stand in.

There is no rollback: going back is a new request.

**The category page** (b2d407b8):

- It is a row place `{kind: 'categories', heading}` beside the card, type and manuscript places, so it survives a reload and has crumbs.
- Each row has a dot, rename, count, style, 设计 › and retire / bring back.
- It writes through the tab's own catalog verb. When the filtered category gets retired, the filter falls back to 全部.

**The board as a table** (f3fee70d):

- The board scroll is layer-1 and the cards are base with a light shadow. Chips get contrast.
- Every category gets a dot: one of six hues by catalog order (retired rows included), mixed with `label-primary`. This is the one colour exception, and the dot always sits beside the words.
- A note that opens with a markdown heading leads with that heading, bold, without the `#`.

**The propose-type row** (e21500cf):

- `canvas_propose_type`'s answer now names the canvas (`（画布 canvas_…）`).
- A keyed `tool.call.toolview` registration reads that sentence back from the call's own settled block and offers 去类型页看看 →. The button opens the canvas tab (`sidebarRight.openTab`, try/catch) and puts its row on the kind's type page.
- The slot is ui-tool's, reached through a structural view of the registry, the eval draft card's precedent. Without ui-tool, the call keeps the generic row.

## Alternatives considered

- **Read the canvas from the call's arguments.** `canvas_propose_type` takes no canvas; it targets the session's focused canvas. The answer is the only place the resolved id exists, and parsing it keeps old calls pointing where they went.
- **Keep management in the panel and widen it.** Rejected: the panel covered the board it manages, and a page gets the crumb, the back path and reload survival from the row model for free.

## Consequences

- The canvas has one colour exception to the "tokens only" rule: the category dot. The READMEs say so.
- Answers from before 0.6.0 carry no canvas id, so their rows show no button.
- Next round:
  - wake the agent on adoption (`agent.followup`);
  - a card-style skill;
  - a migration confirm UI;
  - a fallback migrate button. It shows only when cards lag the adopted version, never merely because a proposal was rejected.

## Testing

- `tests/tab.client.spec.tsx`: 管理分类 opens the page, and retiring the filtered category falls back to 全部.
- `tests/fields.client.spec.tsx`: the categories row restores after a reload.
- `tests/tab.client.spec.tsx`: the headed-note title.
- `tests/card-types.spec.ts`: the answer names the canvas, and the row model parses it.
- `tests/propose-row.client.spec.tsx`: parse states and the button.
- 559 tests green.
