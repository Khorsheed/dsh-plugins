# Agent Note: Canvas card types P1a — the type page, two type tools, three layouts, the field form

Status: implemented

## Problem

The proposal `proposed/feature/2026-09-30-canvas-card-types.md` was approved. Its first phase has to make a category's type real end to end:

- the user states what they want (words, a sketch, an image);
- the agent reads that and drafts a definition;
- the user sees the result and adopts or rejects it;
- the adopted definition changes how cards look and what later agents file.

## Decision

**Host half** (commit b2a6c217):

- A category row carries a `brief`, an adopted `definition` and one pending `proposal`. The store gains `setTypeBrief`, `proposeType` and `decideType`.
- Adopting moves card values along the draft's `renames`. Rejecting a draft that was never adopted drops the category too.
- `canvas_read_type` returns the brief. Drawings are painted to grayscale PNGs on the host (`src/raster.ts`) and attached when the route sees images. This settles the proposal's "can the agent see a drawing" risk without an upstream change.
- `canvas_propose_type` files the one pending proposal, replacing any earlier one.
- `canvas_propose_card` accepts `fields` and checks them against the definition, listing every problem at once.
- `canvas_read_board` lists each definition's field names and types. The hints stay in `canvas_read_type`.

**Client half**:

- **The type page** is the canvas detail's third page kind. The strip stores it as a row place (`{kind: 'type', catKind, heading}`) so it survives a reload. It has three numbered sections:
  - ① the brief, in the card editor;
  - ② the pending proposal: the example drawn with the proposed layout, the rationale, the field table, then 采用 / 不采用;
  - ③ the current definition, above up to twelve sample cards.
- 「交给 Agent 设计」 quotes the category into the main input. It never sends.
- **The way in**: a 设计 button on every category-panel row. A category with a proposal (or an unadopted draft) shows a mark on its row and its filter chip.
- **Three layouts**: note keeps today's face. profile and entry draw a `TypedFace` (title field, then the filled face fields) once a card has field values. A typed title replaces the body heading everywhere a card is named.
- **The card page** gains a field block above the body:
  - Read mode lists the values. A reference is a button that steps to that card; a gone card is disabled and marked. Values the definition no longer names fold under 「已移除的字段」.
  - 「编辑字段」 opens a form. It saves the fields whole, so dropped values ride along. A required field left empty keeps the form open with an alert. A reference picker offers only cards of the field's `refKind`, never the card itself.

## Alternatives considered

- **Rasterize drawings on the client when the brief is saved.** That means an upload on every save and a picture that can go stale. Painting on the host from the stored strokes stays in step by construction.
- **Put the type page in a dialog.** Rejected in the proposal; the row place gives the crumb, the back path and reload survival for free.

## Consequences

- Creating a card from the board is still body-only. Fields are filled on the card page afterwards.
- Deferred to P1b: backfilling fields on existing cards (`canvas_propose_fields`) and the dashed chip for agent-started types. P1c: the custom HTML layout.
- Version 0.5.0: the model-visible tool set grows from five to seven.

## Testing

- `tests/card-types.spec.ts`: definitions, renames on adopt, draft rejection, field validation, the raster.
- `tests/fields.client.spec.tsx`: the face, the field list (reference open, gone reference, dropped values), the form (tags, numbers, carried values, required, reference filtering), the type row's reload.
- `tests/type-view.client.spec.tsx`: brief and proposal preview then adopt, the quote, rejecting a draft steps back.
