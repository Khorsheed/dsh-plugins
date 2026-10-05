# Agent Note: canvas-novel's 成稿 as a book, a structured chapter plan, and a plan card in the conversation

Status: implemented

## Problem

The first cut of the canvas surfaces ([canvas-novel surfaces](2026-10-05-canvas-novel-surfaces.md)) put a chip per chapter on the board strip and a separate `novel:chapter` page per chapter. With many chapters the chips did not scale, the chapters were read one page at a time with no way to read on, and the chapter page duplicated the canvas's 成稿 face. The plan itself (`goal` plus loose lists) did not show where the story was going, so it could not help the person decide whether to confirm it. And a chapter planned in the conversation left only a generic tool row, with no way back to the plan it created.

## Decision

- **The strip is one slim line**: current chapter / 待审 N / 伏笔台账 / 目录 · 共 N 章 ›. The current chapter is the earliest one that needs the person (pending items, or extracted and not reviewed), else the last one. The per-chapter chips are gone.
- **For a 长篇小说 canvas, 成稿 is the book.** The genre declares `ownsManuscripts`; canvas-novel fills the `canvas.board.manuscripts` seat with `ChapterBook`: a contents page (a spine of one tick per chapter, the chapter to pick up at, filters for 待处理 / 未审过, chapters in groups of ten) and the chapter reader in place. The reader (`ChapterReader.tsx`) has a phase lamp, the plan block, this chapter's pending items, the text as a reading column, the ✓ 审过 gate, a glimpse of the next chapter, and a pager with 目录. The `novel:chapter` page stays as a second host of the same reader (its entry `ChapterPage` now lives in `ChapterReader.tsx`); the old `ChapterPage.tsx` file is deleted.
- **The plan is structured around the story**: 梗概 `summary` (required) / 走向 `beats` (each with an optional `at` and a 转折 / 落点 kind) / 冲突 / 看点 / 伏笔 `foreshadowOps` (op + ref + a note saying what is advanced or planted) / 出场 `cast` (with roles and a POV) / 章末钩子. An old-shape plan (`goal`) is rejected by `novel_write` with a message naming the required fields.
- **The plan block follows the chapter's state**: expanded with 确认 while planning; collapsed once prose exists (the text is what is read); after extraction, a delivery line plus a ✓ / ✗ per planned item. A missed foreshadow op goes to 待审 and blocks 审过; a missed beat is only a reminder.
- **The conversation gets a plan card.** canvas-novel registers the keyed `tool.call.toolview` seat for `novel_write`. A chapter answer renders a card (chapter, title, 梗概, counts, a pill for 等你确认 / 已确认) whose one button opens the chapter page on the canvas the answer names. It confirms nothing itself: the plan is judged in full, on the page. While the plan waits, the card re-reads every 10 s so it follows a confirmation made on the page. Every other `novel_write` answer renders as a compact line with the full text behind 详情.
- **Chapter answers name their canvas** (`已登记第 n 章《t》（画布 <id>）…`), so a card from days ago still opens the right canvas whatever the tab shows.
- **The canvas provides a `canvasNav` service** (`openPage(canvasId, page, heading, param?)`), read lazily via `ctx.get('canvasNav')`. Without the canvas the card hides its button.

## Alternatives considered

- **Keep the chapter chips and widen them into a scroller.** Still one chip per chapter; a book of 80 chapters needs a contents page, not a longer strip.
- **A separate `novel_plan` tool, so only plans get the card.** A keyed toolview cannot decline a call, so the `novel_write` row takes over every write (cards, reviews) and renders them as plain lines. A dedicated tool would keep the generic row for those, at the cost of one more tool in the model's set; deferred until the plain line proves inadequate.
- **Confirming the plan inside the chat card.** A summary is not enough to judge a plan; confirmation stays on the chapter page.
- **A 位置 field per beat and a 决策点 list.** The user found 位置 odd (`at` is optional and phrased by the model), and decision points conflicted with confirming the plan — dissatisfaction goes through the conversation. 变化 became 看点.

## Consequences

- canvas-novel depends on two canvas seams added in this change set: `canvas.board.manuscripts` with `ownsManuscripts`, and the `canvasNav` service. A canvas without a genre is unchanged.
- The `novel_write` tool row looks different from other plugins' tool rows; the README's compatibility section notes that the row needs the `tool.call.toolview` slot and degrades to the host's generic row without it.
- Old plans on existing canvases must be re-planned (or hand-edited to the new shape).
- `tests/client.spec.tsx` covers the strip, the book (stat, filters, read in place), the reader (paging, glimpse, last chapter), the plan block states, and the `novel_write` row parse and card door.
