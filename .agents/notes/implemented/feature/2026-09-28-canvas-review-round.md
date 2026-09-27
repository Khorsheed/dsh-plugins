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
- 507 tests pass.
