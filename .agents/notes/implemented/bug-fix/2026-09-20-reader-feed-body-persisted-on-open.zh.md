# Agent Note：feed 自己发布的全文，在第一次打开时留下

Status: implemented

## Problem

发布全文的 feed 把文章随 payload 一起交到面板手里——但只在 feed 的窗口期内。宿主从未持有这份文字：`getEntryBody` 回答 `fromFeed: true`（payload 被原样回显，没有缓存），卡片药丸显示「抓取」、仿佛什么都没有，而条目一旦滚出 feed，文章就直接没了——下一次打开变成对读者已经在读的页面的一次抓取，或者对一个拒绝抓取的站点的一次失败。读者为这份文字一分钱没花，却还是失去了它。

## Decision

**打开即留下。** 当屏上的正文是 feed 自己发布的全文、而宿主没有新鲜的缓存副本时，`open()` 把它写入宿主、成为该条目的正文——走的是原始 payload 清扫用的同一条 `storeEntryBody` 路径，带 `bodyHash: translationHash(html)`，于是条目的译文映射与抓来的正文遵循同一套身份规则（见[状态边界 note](../architecture/2026-09-19-reader-state-boundaries.md)）；被截断的 feed payload 连同它的 `truncated` 标记一起存。这次写入覆盖两种回答形状：宿主回显 payload（`fromFeed: true`），以及面板在宿主空回答之上显示 feed 的 `contentHtml`（缓存过期、记录在案的失败、更老的宿主）。写入落定后清掉该条目的过期标记，并由 `syncFetchState` 定向重读这一条，于是卡片药丸在同一次手势里翻成「已抓取」——这正是[抓取状态 note](2026-09-20-reader-fetch-state-propagation.md) 的传播规则，药丸语义归它所有。

边界不动：新鲜的缓存正文绝不重存（已经付过钱）；`summaryOnly` 条目仍然欠一次真抓取，摘要永不被当成文章存下（见[摘要不是正文 note](2026-09-19-reader-summary-is-not-the-body.md)）；保存的链接条目不碰。空白 payload 什么都不存（宿主会把它记成 `empty extraction` 失败）。

## Alternatives considered

**在刷新/解析时把每份全文 payload 都落盘，不等打开。** 这是换个名字的预抓——为可能没人读的条目缓存正文，正是本包拒绝的爬虫形状（见 [README 的只订阅不抓文](../../../packages/dsh-reader/README.md)）。打开才是读者的手势；把手势已经展示出来的文字存下，才是「付一次」诚实的版本。
**交给自动补齐。** 补齐按设计跳过全文条目（调用方报告它们已有文字）；让它缓存它们等于把同一个预抓往下一层挪。
**只修药丸（feed 有全文就显示已抓取）。** 那药丸就成了客户端算出来的状态——正是抓取状态 note 否决的东西——而且文字照样随 feed 窗口死去。存储才是修复；药丸跟着它走。

## Consequences

- 全文 feed 的条目活过 feed 窗口：一次打开之后，正文、绿色药丸、以及任何译文映射都从宿主缓存读，零请求。
- 药丸的绿色现在意为「插件持有这份文字」，不问来历——一次抓取、一次清扫抽取、或这次的打开即存。README 的药丸段两种语言都写明了。
- 被 feed 自己的全文**替换**掉的过期缓存正文（空回答分支）在写入落定时清掉过期标记——标记仍然描述宿主的副本，而副本现在是新鲜的。
- 每条「未缓存的全文条目」在打开时多一条写入宿主机路径；它每个条目只发一次（下一次打开读的是它自己写出的缓存），不花网络，与任何正文一样受 store 现有的 TTL/预算约束。

## Testing

`packages/dsh-reader` 共 327 个测试（在滚动钳制那条线之上 +3）：

- `tests/ReaderPane.client.spec.tsx`：一个会真正持有的 mock 宿主（`storeEntryBody` 的写入就是之后 `getEntryBody` 与 `entryFetchStates` 的回答来源）驱动三个用例——打开存下 feed 全文（带 `bodyHash`），返回后药丸翻成已抓取；再次打开读缓存，不写第二遍；summaryOnly 的打开照样付它那一次抓取，且摘要永不入库。两个存储用例对改动前的代码红；摘要用例两侧都绿，这是设计——它钉住的是改动不得越过的边界。
