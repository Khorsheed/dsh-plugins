# Agent Note: dsh-reader 让慢抓取可见，并把题图救回来

Status: implemented

## Problem

2026-10-14 的用户反馈分两半。**慢抓取看起来像没反应。** 打开或新增一篇长文章要在「解析链接 API → 抓页面 → 提取 → 保存」这条链上花几秒到半分钟，而唯一的过程提示是详情页一行静态的「正在抓取正文…」——新增弹窗干脆什么都没有，一次慢的新增读起来就像点了没反应（还会引人再点一次）。**图片丢失。** 在 `anthropic.com/research/investigating-unintended-model-actions` 上，存下的正文里一张图都没有：打分器只保留文本最重的那一个容器，而杂志式版式把封面图放在它前面的兄弟包装里——在 `<article>` 之内、胜出容器之外，从来没被够到。同被提到的另一篇（`self-replicating-ai`）其实三张配图都提取正常，存储的正文里一直都在。

## Decision

**抓取进度用阶段线，不靠猜。** 抓取接力（`client/index.ts` 的 `fetchEntryBody`）通过注入面新增的 `onPhase` 可选回调上报各段——`downloading` → `extracting` → `storing`（`ReaderFetchPhase` 定义在 `client/contract.ts`）。同步提取前让出一个宏任务，「正在解析」这一阶段才能真正绘制出来——多 MB 的页面这一步在 Chromium 实测约 897 ms（2 MB / 49k 元素的 arXiv 论文；jsdom 下同一份要 15 s）。详情页用新的 `BusyLine` 渲染阶段（转圈 + 文案 + 超过 3 秒后追加已用时，复用渲染抓取既有的 `renderingLine`/`renderingRing` 样式），按 entry id 归属，后台卡片抓取的状态不会串到屏幕上。新增弹窗加上同一条状态线（「正在识别并抓取链接…」），忙碌时禁用输入框与提交钮，并挡住重复提交。

**刷新并发抓、串行写。** `service.refresh()` 从严格串行循环改为有界工人池（`REFRESH_CONCURRENCY = 3`，`src/service.ts`）——一个卡死的源（完整 30 s 超时）不再拖住排在它后面的所有源。文档写入仍单排在池后：逐源失败记录与最终的源补丁合批提交都串行执行，因为 store 的提交是读-改-写，两个并发提交就是丢更新的来历。

**题图嫁接进正文。** 打分与导条修剪之后，`graftLeadingFigures`（`src/client/extract-article.ts`）把位于胜出容器之前的合格图块移到它的开头：`<figure>`/`<picture>` 仅凭语义标记即合格，裸 `<img>` 必须声明 width ≥ 480（`LEAD_IMAGE_MIN_WIDTH`），图标和头像进不来；最多嫁接两张（`LEAD_GRAFT_MAX`），保持文档序。作用域取最外层的 `article`/`main` 祖先——Anthropic 的模板是 `article > wrapper > article > 正文列` 的嵌套，题图挂在最外层那棵里。嫁接安排在 `trimLeadingChrome` 之后：若先嫁接，开头的题图会让导条修剪在图片边界就停下，把后面的刊头杂项留在正文里。正文之后的内容（相关阅读网格）永不触碰。这次还带出一个既有缺陷：导条修剪只查后代里有没有图，于是一张裸的开头 `<img>` 会被当刊头删掉；现在节点自身即停住修剪。

**读取 `data-srcset`。** lazysizes 形态（占位 `src`、真实候选列表在 `data-srcset`）此前没有任何解析路径会看；`imageSrc` 与 `pictureImg` 现在在真实 `srcset` 之后回退到它。

## Alternatives considered

**真实的字节级下载进度。** 抓取 seam（`ctx.web.fetch`）先缓冲完整响应再应答，百分比要么靠 reader 自己实现页面抓取（重复 seam 的全部加固），要么加一个 `RemoteStream` 动词。两种都只多给一个「到了多少字节」的数——而读者真正的不确定是「到底有没有在动」，阶段线加已用时用很小的代价回答了它。

**先展示后保存。** 提取出的正文本可以少等一个往返就渲染（`storeEntryBody` 后台发）——但墙上的抓取标记读的是宿主注释，抢先重读会落在保存前的 `raw` 记录上（sweep 随后会把同一正文再提取再存一遍）。几百毫秒不值这套补偿逻辑。

**给所有含图块打分并合并多个容器。** 单容器打分加定向嫁接是更小、更可预期的规则；多块合并的失败模式（带进评论区和相关阅读网格）正是打分器存在要防的东西。

**并行化 `sweepRaw` 的两条。** 提取那一半反正是主线程同步活；重叠两个 Remote 调用收益很小，还会动摇「一次只跑一个 sweep」的不变量。

## Consequences

- 慢新增、慢打开现在会显示转圈、当前阶段与已用时；重复提交的路被关掉。N 个源的刷新耗时从「总和」降为「每三个一批的最大值」。
- Anthropic 式题图（以及任何位于正文之前的 figure/宽图）现在会落在提取正文的开头；反馈中的那篇文章从 0 张存图变为带上封面。在此修复**之前**存下的正文维持旧内容，直到缓存过期或手动「重新抓取」——`repairStoredBody` 修不回从没进过 markup 的东西。
- 嫁接有界（最多两张、仅在胜出容器之前、语义标记或声明宽度够格）；在 article 作用域里以宽幅推广横幅开头的页面会把它带进来——接受，因为那是页面自己选择的开头。
- 测试：`tests/extract-article.spec.ts` 钉住嫁接（题图、前导 figure、不取尾随、不收图标、胜出容器已含图时的幂等）与 `data-srcset`；`tests/ReaderPane.client.spec.tsx` 钉住在途阶段线与新增弹窗的忙碌/防重行为。
