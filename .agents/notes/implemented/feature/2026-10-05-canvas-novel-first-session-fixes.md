# Agent Note: canvas-novel first-session fixes: duplicate cards, named world cards, paragraphed manuscripts

Status: implemented

## Problem

The user handed a few written chapters to the model on the temp instance and hit three problems:

- **Duplicate character and world cards**: the import only recognized accepted characters, so every experience of a character introduced in the same payload was dropped, and the report gave no refs for the new ghost cards. The model then re-created the characters with `novel_write(card)` and wrote duplicate world cards too.
- **World cards had no title**: a world card held a single `rule` paragraph, so the board could not tell a place from an item from a rule.
- **Manuscripts had no paragraphs**: the model wrote one newline per paragraph, and Markdown rendered the chapter as one wall of text.

## Decision

- **One name, one card**:
  - When `writeCard` creates a character or world card and a non-archived card with the same name exists (ghosts included), it answers `duplicate` with that card's ref; the tool text tells the model to edit that card.
  - The import does the same: a world setting with a taken name is dropped as `duplicate`, and so is a repeat within one payload. A character already on the canvas is not new, and its experiences still reach it by name.
- **New characters in the same payload keep their experiences**: the import lands cards first, then files `experiences` / `current_states`, resolving new characters' card ids by name.
- **The report carries refs**: each `proposedCards` item has a `ref`, so the model fills a card in by ref.
- **World cards are now name + kind + setting**:
  - `name` is required and serves as the card title; `kind` is a select (地点 / 势力 / 道具 / 规则 / 历史 / 其他); `rule` holds the detail. The genre moves to `novel@2`.
  - The extract schema gains `name` / `world_kind`; without a name, the first clause of the content is used (16 characters at most).
  - The brief renders `名称（类型）：设定`.
- **Existing canvases catch up with the genre (canvas)**: before a `mutate` write, if `board.genre.version` lags the registered genre, the fields missing from the seed definition are added to the category definition. Fields the user changed (labels, say) are kept, fields the user added follow, and the definition version goes up by one. This happens only on the canvas's next write; there is no separate migration.
- **Manuscript paragraphs**: when `writeChapter` receives a multi-line body with no blank line, each line becomes a paragraph separated by a blank line; a body that already has blank lines is left as is.

## Alternatives considered

- **Compare the seed and stored definitions by version.** A category definition's version goes up on every adoption, so it cannot be compared with the seed's; comparing the genre version recorded on the canvas works instead.
- **Merge a same-name card into the old one.** Merging would silently change a card the user already accepted; refusing with the ref and letting the model edit explicitly is easier to control.

## Consequences

- Old world cards have no name; their title falls back to the card name or id until the user or the model fills it.
- Duplicate cards created earlier are not cleaned up automatically; the user discards them with ✗.
- Manuscripts written earlier without paragraphs are not rewritten.

## Testing

`pnpm --filter @khorsheed/dsh-canvas test` (585, including the genre catch-up); `pnpm --filter @khorsheed/dsh-canvas-novel test` (49, including the duplicate refusal, import dedupe and new-character experiences, and manuscript paragraphs).

## Related

- [canvas-novel engine](2026-10-04-canvas-novel-engine.md)
