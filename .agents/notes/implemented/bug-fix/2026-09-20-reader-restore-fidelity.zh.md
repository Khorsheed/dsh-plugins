# Agent Note：恢复的保真——墙面翻译真的回来，迟到的正文不落地，位置扛住译文视图

Status: implemented

## Problem

面板恢复机制里的三个缺陷，同属一类：页面记忆被**忠实地写下**，但读回来的东西没有忠实地到达屏幕。

1. **墙面的翻译状态被镜像了，却从未被恢复。** `wallOn` / `wallBoth` / `cardTranslations` 每次变化都写进页面快照，却从裸的 `useState` 默认值初始化——于是 hydrate 之后第一次镜像覆盖，就用 `false` / `false` / `{}` 把记住的地球和卡片译文抹掉了。重新挂载的面板看到的墙永远是未翻译的。
2. **迟到的正文回答落到别的条目名下。** `open()` 和 `fetchBody()` 在 await 宿主之后写 `articleHtml` 时没有任何守卫：开 A、返回、开 B，A 的 `getEntryBody` 最后才 resolve，A 的正文就渲染在 B 的标题下——而按 `[openEntryId, articleHtml]` 键恢复的译文，会把这对从未存在过的组合再翻一遍。
3. **阅读位置的漂移恰好长在译文视图里。** 锚点的块内 `offset` 是像素，只对测量它的那个布局有效；翻译换了一套词（中文比英文短），同一段落是另一个高度，像素就指向了另一个句子。20 秒 settle 窗口关闭之后，视图变化时没有任何东西重新测量或重新落锚。（锚点机制本身见[状态边界 note](../architecture/2026-09-19-reader-state-boundaries.md)；恢复键见[译文跟随 note](2026-09-19-reader-translation-follows-its-body.md)。）

## Decision

1. **三个墙面状态从挂载时的快照初始化**（`snapshotRef`，hydrate 读的就是这份副本），于是镜像的第一次写入带的是恢复出来的值而不是默认值。镜像现有的守卫（跳过第一次运行、等 hydrate 完成）兜住其余。
2. **`openRequestRef` 指明详情页此刻属于哪个条目。** `open()` 同步写入它；每个要写正文状态的异步续体先核它——`getEntryBody` 的续体、无链接条目的 `getBodies` 续体、`fetchBody` 的回答。`closeEntry` 清空它（一个按 `openEntryId` 键的 effect）。条目不在屏上的 `fetchBody`（卡片药丸、读者已经离开的条目欠的那次抓取）照旧记录按条目的读数（`fetching`、`staleBodies`），但不再碰正文区。
3. **锚点增加文本偏移。** `ReaderReadingAnchor` 携带可选的 `text` / `textLength`：记录时刻锚点块内文本的字符偏移，从缓存的几何换算出来（滚动处理器仍然不读布局、不碰 DOM）。页面记忆与 `sessionStorage` 都带这两个字段；它们出现之前写下的锚点照旧按像素恢复。恢复时（`offsetInBlock`）的顺序是：文本没变（`textLength` 相等）→ 用 Range rect 定位那个字符的确切像素点；词变了（译文）→ 文本的同一**分数**；都不行 → 存下的像素。视图变化时重新落锚：一个按 `translateView` / `translatePhase` 键的 effect 在译文落地或视图切换时重新测量各块、重新应用当前条目的锚点——这是刻意的一次性布局读取，不是滚动处理器，也不靠 settle 窗口。

## Alternatives considered

**像其它被恢复的字段一样，把墙面状态挪进 store 走 hydrate。** 它们是 `useState`，不是 store 字段；挪它们要搅动 store 契约却换不来读者看得见的好处。从 hydrate 读的同一份快照初始化，是更小也诚实的修法。
**取消旧的那次打开，而不是给它的续体加守卫。** 宿主的 Remote 调用没有取消令牌，而且守卫和翻译运行已有的形状（`cancelRef`）一致；守卫还覆盖取消覆盖不到的路径（宿主可能照样回答）。
**复用现有 settle 窗口做重锚（延长它，或在视图变化时重开它）。** 那个窗口是为前 20 秒里持续长高的文档准备的；视图切换可能发生在几分钟之后，为一次性的变化重开一个 ResizeObserver 循环是错误的生命周期。一个按键的 effect 精确地说出了几何何时动了。
**按像素比例记（`offset / height`）而不是文本偏移。** 记录时信息相同，但恢复时少了精确那一档：文本没变时（字体落定、图片到达）Range rect 钉住的是同一个**字符**，比率做不到。
**每次展开单句原文（segment toggle）也重新测量。** reveal 在段落下展开会把下方的块往下推；不在本次范围内——被指名的缺陷是视图切换，而且 reveal 的情况移动的是锚点块**以下**的内容，块序号本身已经吸收了它。

## Consequences

- 重新挂载的面板看到的墙已经是翻译好的，视图也停在读者离开时的那一档——墙的那一遍翻译会对着页面缓存的翻译会话重跑，所以不花手势，通常也不花请求。
- 宿主回答再慢也覆盖不了屏幕：最后一次打开（或一次关闭）拥有正文区。译文恢复的 `[openEntryId, articleHtml]` 键再也不会看到错配的一对。
- 位置在两个方向上都扛住原文↔译文切换：点亮地球落在同一个句子（译文文本的同一分数），切回去则精确解析记录的那个字符（原文逐字节还原，所以 `textLength` 对得上）。
- `offsetInBlock` 与 `ArticleBlockMetrics` 从 `ReaderPane.tsx` 导出供 spec 用——纯映射正是 jsdom 缺失的布局经渲染面板够不到的那部分。

## Testing

`packages/dsh-reader` 共 282 个测试（在懒加载那条线之上 +8；除向后兼容用例外，全部先对着修复前的代码红过——兼容用例两侧都绿，这正是它的职责）：

- `tests/ReaderPane.client.spec.tsx`：墙面的开关与卡片译文跨重挂载恢复，零点击；两个竞态用例（迟到的 `getEntryBody` 回答、迟到的欠账抓取回答）都不落到新条目名下；译文用例用了一个块高随文本长度走的布局桩，所以翻译落地后重锚的位置是新文本的同一分数；「记录的块」用例现在断言锚点的文本字段。
- `tests/reading-position.spec.ts`（新增）：纯映射——旧锚点的像素直通、文本不变时的 Range 精确解析、文本变了或没有布局时的比例兜底。
- `tests/session.spec.ts`：文本字段随页面记忆与 `sessionStorage` 存档往返；它们出现之前存下的锚点原样读回。
