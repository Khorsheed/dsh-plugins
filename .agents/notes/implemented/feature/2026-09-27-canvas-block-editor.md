# Agent Note: A card's body is one flow of words, drawings and images

Status: implemented

## Problem

A card held text plus at most one drawing, and the drawing always rendered after the text. Editing was two separate surfaces: a text box, then a pad below it. You could not put a sketch between two paragraphs, draw twice on one card, or paste a screenshot where the caret was. A pasted image went to the end of the text as a raw `![](attachment://…)` line. In the 2026-09-27 review the user asked for text, drawings and images to interleave in one editor. The editor was to pull in no big editor library, image paste had to work, and the markdown/HTML rendering had to stay as it was (memory: canvas UX redesign decisions, step 6).

## Decision

**The card stays one markdown string; pointer lines make the flow.** A line holding nothing but `![](draw://<id>)` places that drawing there. For the editor, a line holding only an `attachment://` image is that image's block. Everything else is words. The agent reads, the source pane edits and the board summarizes the same plain text as before. `src/blocks.ts` holds the parsing, which is runtime-agnostic:

- `blocksOf` / `cardBlocksOf` split text into blocks. They track code fences, so a pointer inside a fence stays code. An inline pointer or a malformed id stays words.
- A drawing the text does not place still belongs to the card and flows at the end, the legacy drawing first. That covers old cards and agent rewrites that drop a line. A pointer to a missing drawing, or a second pointer to the same one, drops out.
- `textOfBlocks` writes a flow back, one blank line between blocks. `freshDrawingId` picks `d1`, `d2`, ….
- `withoutDrawLines` strips pointer lines for readers that cannot draw them: the board summary, a quote into the conversation, and the body of a manuscript turned from a card.
- `firstDrawingOf` gives the thumbnail on the board and the link map: the first drawing in reading order.

**Multiple drawings per card.** `CanvasCard.draw` became `drawings: Record<id, strokes>`:

- at most `MAX_CARD_DRAWINGS` (12) drawings;
- ids match `[a-z0-9]{1,16}`;
- inkless drawings are dropped on read.

An old card's single `draw` is read as `drawings.main` (`LEGACY_DRAWING_ID`). The text names no place for it, so it renders last, where it always did. `putCard`/`patchCard` accept `drawings`, and an empty map removes the field.

**`BlockEditor` holds no editor library.**

- Each text block is an uncontrolled `CardTextarea` with no border of its own; the blocks sit on one bordered sheet.
- Each drawing is a `CardPad` with a 移除这幅手绘 control.
- Each image is a figure whose remove button appears on hover or focus.
- 手绘 and 图片 in the bar, and pasting images, insert at the caret of the last focused text block. The block is split there, so a paste lands between the words around the caret.
- Removing a block joins the words on either side of it.
- An added drawing that was never drawn on is not saved.
- A paste without images goes to the page's existing paste handling (format detection, the denoise).

The editor is used in two places:

- **Create draft**: Enter adds the card (`submitOn="auto-enter"`, the draft's old keyboard).
- **Card edit**: ⌘⏎ saves (`submitOn="mod-enter"`). Esc puts the pen away, so the pad's hint reads "Esc 收起画笔 · ⌘⏎ 保存".

**The mode switch splits by format.**

- A markdown card has 阅读 / 编辑 / 源码:
  - 阅读 renders the flow with drawings in place (`CardFlow`);
  - 编辑 is the block editor;
  - 源码 is the raw text with the pointer lines visible.
- An HTML card keeps 渲染 / 源码 / 并列 and whole-card render. Its drawing is a page annotation, not a block, so its one pad is kept on `drawings.main`.

## Alternatives considered

- **An editor library (ProseMirror/TipTap, Lexical, Slate).** Rejected by the user's constraint: each is a large bundle for a plugin, brings its own document model and would have to be taught drawing nodes. Three block kinds with split and join do not need one.
- **A JSON block model stored on the card.** Rejected: the agent, the source pane, the quote, the manuscript turn and the board summary all read `card.text`. A second representation would need a converter at every one of them and would drift. Pointer lines keep one source of truth that is still readable markdown.
- **Keep one drawing, just movable.** Rejected: "sketch here, then again after this paragraph" is exactly the case asked for.
- **A contenteditable surface.** Rejected: caret and IME behavior in mixed content is where editor libraries spend their size. Plain textareas already handle CJK input correctly.

## Consequences

- `card.text` may now contain `![](draw://…)` lines. A reader outside the plugin sees them as broken images. Plugin-side readers strip them via `withoutDrawLines`; the agent sees them in the text, and they are cheap to keep.
- Board schema: `drawings` replaces `draw`. Old files are read compatibly, and writes emit only `drawings`.
- HTML cards are unchanged apart from their pad storing under `main`.

## Testing

- `tests/blocks.spec.ts`: splitting, fences, lifting lone images, inline and malformed pointers, unplaced and duplicate drawings, round trip, `freshDrawingId`, `withoutDrawLines`.
- `tests/block-editor.client.spec.tsx`: open and save unchanged, image paste splitting at the caret, a non-image paste handed on, remove-and-join, an inkless drawing dropped, and change reporting.
- Detail, strip, tab, link, board and quote specs moved to the `drawings` model: 509 tests pass.
- Visually verified on a temporary instance:
  - read mode with a drawing in place;
  - the edit sheet with the 手绘/图片 bar;
  - drawing, then pasting an image mid-text, then saving;
  - the source view with the pointer lines;
  - the board thumbnail taken from the first drawing.
