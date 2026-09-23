# Agent Note：被白名单丢掉的两种图片形态

Status: implemented

## Problem

主场景的两类真实页面被同一张白名单丢了图，形态各不相同（都是 3080 验收中用户报上来的）：

- **arXiv HTML 的图**（`arxiv.org/html/2604.03147`，线上实测）：LaTeXML 把矢量图嵌成 `<figure class="ltx_figure"><object type="image/svg+xml" data="…/circumplex.svg" width height></object><figcaption>…`。`object` 在 `DROP_TAGS` 里，于是整棵子树在打分前就死了，只剩图注——正是脚本图设计要防止的那种「插件把我的图弄丢了」的读感。
- **transformer-circuits 的图**（`/2026/emotions`，41.8 MB HTML）：87 个 `<img src="data:image/png;base64,…">`，每个数百 KB——是页面**真正的**插图，直接内联。懒加载回收把所有 `data:` URI 都当成 1px 占位图，穿透到并不存在的属性上，把图删了。那条策略是为相反的形状写的（占位 src 把真 URL 藏在 `data-src` 里），而它过拟合了。

## Decision

两个修复都在 `client/extract-article.ts`，都保留旧规则对它本来正确的形状的行为：

- **image 类型的 `<object>` 变成 `<img>`**（`objectImg`）：`type` 必须以 `image/` 开头，`data` 必须过每个 URL 都要过的 scheme 检查（相对地址按页面解析；`data:`/脚本 scheme 拒绝）；纯整数的 `width`/`height` 随行——已知尺寸是稳定排版与[状态边界 note](../architecture/2026-09-19-reader-state-boundaries.md) 里那个不断长高的文档之间的差别。其它任何 object（PDF、视频）照旧整棵丢弃，连兜底子节点一起——它们复制的是图注，不是画面。脚本图探针把 `object[type^="image/"]` 学会为内容；行内摘要通道像跳过 noscript 一样跳过 object。
- **`data:` 图片在有实质内容时保留**（`substantiveDataImage`）：MIME 必须是真的图片类型（`png|jpeg|gif|webp|svg+xml|avif`），载荷必须达到 512 字符。1px 占位图约 70 字符；最小的真图表是数千——阈值离两边都远，所以不存在擦边判决。base64 载荷输出时剥掉空白（页面会折行）。过不了闸的 data: URI 按**缺席**计——照旧穿透到懒加载属性，占位图依然会让位给 `data-src` 里的真 URL。同一道闸也用在 `srcset` 候选上（逗号拼回本来就让它们可解析）。

**存储，想清楚了**：接受这些意味着提取正文现在要装下数 MB 的 base64。既有机制接得住：超过 `INLINE_BODY_MAX_CHARS`（256 KB）的正文是 `bodies/` 下的 sidecar 文件，`state.json` 只留清单，`pruneBodies` 按引用清扫，`boundAnnotations` 按条数 + TTL 淘汰。诚实的最坏账：条目正文按**条数**（默认 500）与 TTL 约束，没有字符预算，所以抬高出网上限的部署（验收实例 64 MB）磁盘上可能留着 maxEntries × 上限 的 base64 重磅正文。这是部署策略层面的答案，不是 bug——同一条界本来就适用于任何超大页面——但记录在此，因为这次改动让大正文对多图论文成为**常态**而不是角落。

## Alternatives considered

**把非图片 object 解包到兜底子节点。** 兜底内容是「你的浏览器显示不了」的铬件或图注复制品；整棵丢弃对一切非图片保持旧行为——那个行为从来没人抱怨。
**继续拒绝一切 `data:` src。** 那就是 bug 本身：transformer-circuits 内联的是真图；「有些 data URI 是占位图」推不出「每个都是」。
**按内容嗅探占位图（1×1 gif 签名）而不是按大小。** 对精心构造的 600 字符占位图更精确，但这道闸要分开的是「追踪像素」与「插图」，而大小用一个比较就把两个总体隔开几个数量级。若哪天有真实页面在阈值附近混排，嗅探这条路还在。
**把 data-URI 图外置成各自的 sidecar 文件并重写 src。** 刻意推迟：面板渲染的是存下来的 HTML 字符串，所以 `<img>` 的 src 必须是浏览器能加载的 URL，而 Remote 出的是 JSON 不是二进制 GET——可服务的图片 URL 是宿主缝的活（资源 scheme 或 blob 管线），属于 capture 里程碑，不属于今天把两个页面修好。在此期间正文是自包含的：配额、淘汰、引用都把它们当普通正文对待。
**给接受的载荷加上限。** 否决：缝自己的上限就是页面能送达的外界；再加一道内界等于把部署刻意放行的东西又静默截断一次。

## Consequences

- arXiv HTML 论文带着矢量图到达（`<img>`，带尺寸）；transformer-circuits 一类页面留住内联图表；两个真实页面 fixture 与 arXiv fixture 的抽取结果除新保留的图外逐字节不变。
- data URI 的 `<img>` 输出照样带 `referrerpolicy="no-referrer"`（对 data: 是空操作，但规则只有一条）。
- 行内摘要整棵跳过 object；figure 的兜底铬件不会漏进卡片摘要。
- 上面的磁盘账是可见的那个代价：多图论文按设计现在是大正文。

## Testing

`packages/dsh-reader`：`tests/extract-article.spec.ts` 驱动两个新 fixture 与行内用例，每个都先对着改动前的提取器红过。`tests/fixtures/arxiv-object-figure.html`（LaTeXML 形状）：SVG object 图存活为绝对化 `<img>`、带宽高、其 figure 不计脚本图；PDF object 整棵丢弃；feed 正文路径同规则（含无 `data` 与 `data:` 寻址的 object）。data-URI 用例：1px gif 占位照旧让位 `data-src`；实质 base64 png 原样保留（剥空白）；512 字符边界两侧各钉一例；非图片 data URI 永不保留；实质 data 候选能赢下 srcset。
