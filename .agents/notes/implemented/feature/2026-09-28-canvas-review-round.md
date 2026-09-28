# Agent Note: Canvas 2026-09-28 review round — header, editor bar, new-card tile, tabs, pen widths

Status: implemented

## Problem

The user walked canvas 0.4.8 on 3080 and raised six points:

- **Card header.** 与 Agent 对谈 and 开始写作 felt unnatural. Talking is what quoting the card already does, and 开始写作 did not say what it meant.
- **Editor tools.** The editor's 手绘/图片 tools sat low enough to be missed. Images could not be dragged in or opened large, and the save button floated apart from the sheet. The user wanted one editor that a later 表格 could join.
- **New card.** It opened on a page of its own, which felt abrupt. The user suggested a dashed tile after the cards instead.
- **顺线扩一圈.** Nobody understood this link-view action.
- **Tab strip.** The inner canvas tab strip stacked awkwardly under the sidebar tabs. Its × was tiny and not the official icon, and a sun icon read oddly.
- **Pen widths.** Earlier the model had said the pen could take several widths, and the user asked for them now.

## Decision

**Header.** 对谈 and 开始写作 leave the card header. 引用整卡 moves into the ⋯ menu, and the card-to-manuscript action is renamed 「让 Agent 写成稿」.

**Editor.** `BlockEditor` is one bordered sheet with a sticky top bar:

- On the left, an insert group (`role="toolbar"`, 插入) built from an `InsertTool[]` list: 手绘 and 图片 today, and a table would be one more entry.
- On the right, the ⌘⏎ hint and 取消/保存.
- **Drag in.** Dropping images inserts them at the gap nearest the pointer. `gapAt(clientY)` finds the gap from the `data-slot` midpoints, and a 放到这里 line marks it while dragging. A drop with no images says 只能拖入图片.
- **Lightbox.** Clicking an image opens the host `ImageLightbox`, in edit and in read mode (`useImageLightbox`, a click delegated on the container). An image inside a link stays a link.

**New card.** New cards start from a dashed ＋ tile at the end of the board grid (`DraftTile`). On an empty board the tile is the first cell and carries the empty-board invitation.

- The tile turns into an inline draft in place: kind select, text, 取消/添加, ⏎ files the card.
- 展开 carries the typed words to the full editor for drawings or images.
- The topbar kind menu opens the tile draft with that kind instead of a page.

**顺线扩一圈** is removed.

**Tab strip.** The strip uses underline tabs and the official close icon, and the sun icon is gone. Several canvases can still be open at once, as the user asked.

**Pen widths.**

- 细/中/粗 is a segmented control beside the pen, shown only while the pen is up. The last pick carries to the next pad (module-level).
- `CanvasStroke.size?: 'thin' | 'medium' | 'bold'` is stored only when it is not medium. `normalizeDraw` and `appendStroke` drop medium and unknown values, so every older stroke reads as 中.
- `strokePathOf` scales perfect-freehand's `size` by 0.5 / 1 / 1.9, and the live stroke previews at the chosen width.

**Second pass, same day (0.4.10).** After a look on 3080:

- **The editor fills the page.** The sheet takes the page's remaining height (`flex: 1 0 auto`, 320px floor). Its words sit in a centred reading column of about 760px (`padding-inline: max(18px, (100% - 760px) / 2)`) at 14px/1.8. The last words block runs to the sheet's foot, so a click in the empty lower half lands in it.
- **The tile draft fills its cell** (180px floor, and the words take the room between head and foot).
- **The topbar ＋新卡 menu is removed.** It duplicated the tile and read as abrupt. The kind is picked in the tile's own select.
- **The tile reads 「新增{kind}卡片」**, named for the kind it starts, for example 新增灵感卡片.

**Third pass, same day (0.4.11): whole HTML blocks in markdown.** An agent drew a `<div style=…>` diagram in a manuscript, and the page showed its source. The host's `MarkdownText` keeps raw HTML literal by design and has no extension point.

- `splitHtmlBlocks` (`src/html-blocks.ts`) cuts whole blocks out before rendering. A block opens on a line that starts (after at most three spaces) with a block-level tag, and only when that tag closes further on. Nesting, several lines and blank lines are balanced by the depth of that same tag.
- Inline HTML, tags inside a code fence and an unclosed tag stay markdown, and nothing after them is swallowed. A text with no block comes back unchanged and still renders as one `MarkdownText`.
- Each block renders in the same sandbox as an HTML card (`CardMarkdown`, reusing inline-html-render's `buildCardSrcDoc` + `attachBridge`): the strict card CSP, no network, scripts confined to an opaque origin, height reported by the bridge. The card detail's text blocks and the manuscript's reading view and edit preview all use it.
- **Dark theme:** authored blocks carry light colors. When the host body carries `data-ds-dark-theme`, the iframe gets `invert(0.88) hue-rotate(180deg)` from outside: the white ground turns dark, the text turns light, hues stay, and a theme switch needs no reload.
- The iframe element and its document are both pinned to `color-scheme: light`. When the two schemes differ, the browser paints the iframe an opaque backdrop, which the inversion showed as a grey band (caught in a screenshot check).
- The board summary shows each block as 「[图示]」, never its source.

**Fourth pass, same day (0.4.12).** From a second look on 3080:

- **The canvas picker is a ＋ after the last tab**, like the sidebar's ＋. The strip no longer stretches (`flex: 0 1 auto`), so the ＋ follows the tabs. The trigger is icon-only (「打开或新建画布」 as its name) and still opens the same list of boards plus 新画布. Near the right edge the list flips to open leftward (measured on open).
- **Lanes can be deleted.** A × on the lane's top-right corner appears on hover. It removes only the lane (a `lanes` patch); every card stays where it sits, and a toast says so.
- **The link view's tools float inside the board.** A dock at the top right always holds the totals (「2 个分区 · 1 条线」) and ＋新分区. The selection actions (对谈, 写成稿, 删掉这条线, 取消选择) move to a floating bar at the bottom centre that shows only while something is selected. The old full-width bar below the board is gone.
- **The lane title is a chip.** It is the same box whether shown or edited (22px, the layer-1 ground, radius 6). Editing adds a brand border and a soft ring and outlines the lane. Escape cancels, and an unnamed lane shows 未命名分区 as a placeholder.
- **The ⋯ icons are the host's own** `IconEllipsisOutlineMedium`. They were drawn at 13px against the host default 16. Only the glyph grows to 16; the buttons keep their 22/24px boxes, so the hover square still matches the selected box (the user's call).
- **The category panel copy and layout are reworked.**
  - The head reads 「分类 只作用于这块画板」, and the storage path moves into its tooltip.
  - Each row shows the count, a small 内置 tag and a ghost 停用 button.
  - The two rules are a short list under a divider: renaming changes only the display, and retiring a category archives its cards (with the way to keep them).
  - A built-in's default name shows as the placeholder, so it is tinted as the name itself. The UA grey was too faint on dark (caught in a screenshot check).

**Follow-up (0.4.13): the strip draws no scrollbar.** With the strip content-wide, a sub-pixel overflow showed as a bar under two short tabs when macOS always shows scrollbars. The strip hides its scrollbar (`scrollbar-width: none`) but still scrolls: a vertical wheel turns sideways (native non-passive listener, only while the rows overflow), trackpad swipes work as before, and the showing row scrolls into view whenever it changes.

## Alternatives considered

- **A bottom toolbar or a floating toolbar for the editor.** Rejected: the user picked the sticky top bar, which stays in view on a long card and has room for more insert kinds.
- **Width stored per point (`w`).** Rejected: `w` already carries speed-derived pressure capped at `PEN_MAX`, so it cannot grow. A per-stroke multiplier keeps pressure and width independent and leaves old data untouched.
- **Keeping the new-card page as the only path.** Rejected as the abrupt jump the user named. The page stays reachable through 展开.

## Consequences

- Board schema: strokes may carry `size`. Readers that do not know it render the stroke as medium, so it is backward-compatible.
- `appendStroke` must carry every stroke field that it keeps. It silently dropped `size` until a test caught it.

## Testing

- `tests/draw.spec.ts`: `normalizeDraw` keeps thin/bold and drops medium, missing and unknown; thin inks narrower and bold broader than medium; a missing size inks as medium.
- `tests/detail.client.spec.tsx`:
  - the width group appears only with the pen;
  - a medium stroke has no `size` and a bold one stores `bold`;
  - a new pad opens with the last width.
- `tests/block-editor.client.spec.tsx`: the bar order, a drop into a gap, a non-image drop, the lightbox.
- `tests/tab.client.spec.tsx` and `tests/strip.client.spec.tsx`: the inline tile draft, 展开, ⏎ filing, the empty-board tile.
- `tests/html-blocks.spec.ts`: splitting, balancing across lines, a self-closing svg, an unclosed tag, fences, indented and mid-line tags, the summary mark.
- `tests/manuscript.client.spec.tsx`: a whole HTML block in a manuscript renders in a sandboxed iframe (with the CSP), not as source.
- 516 tests pass.
- `tests/link.client.spec.tsx`: deleting a lane is a `lanes` patch that leaves every card where it sits; Escape in the lane name cancels; a readonly board shows no lane delete; the totals read from the dock.
