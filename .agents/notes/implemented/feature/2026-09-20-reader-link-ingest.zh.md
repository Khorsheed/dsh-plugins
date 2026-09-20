# Agent Note：粘贴的论文链接落为它的 arXiv HTML 版

Status: implemented

## Problem

灵感空间的第二个主场景是读论文（用户 2026-09-20 定调，见[摄入提案](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md)），而添加流程此前把每个论文链接都当成不透明网页：

- `arxiv.org/abs/<id>` 链接存下的是**摘要页**——一段摘要加元数据，永远不是论文本身；
- `arxiv.org/pdf/<id>` 链接变成「仅链接」卡片（出网缝拒绝 `application/pdf` 是对的），尽管 arXiv 为同一篇论文提供 LaTeXML 生成的 HTML 版（`arxiv.org/html/<id>`）——实测 `2604.03147v1`：384 KB 语义标记，15 个真 `<table>` 与 MathML 公式，既有白名单管线原样就能消费；
- `doi.org/…` 链接是最差的结局：doi.org 用跨站 302 跳到出版方，宿主缝按设计拒绝跨源跳转，于是卡片只说「跨站跳转」，而 DOI 背后的论文——很多时候就在 arXiv 上——根本没人去找；
- `openreview.net` 链接只能靠抓一次来诊断，而抓取实测是死的：API 在 Cloudflare 人机挑战后面（403），论坛是 JS SPA（静态 HTML 的 title 恒为 "Forum | OpenReview"）。今天不存在任何服务器端读取它的路径。

## Decision

添加流程（`ReaderService.addSource`）在第一次抓页面**之前**识别论文链接，分两级：

- **arXiv 直链升级**（`src/arxiv.ts`，纯函数）：`/abs/<id>` 与 `/pdf/<id>` 解析出一个论文 id（新式 `YYMM.NNNNN(vN)`、存档式 `hep-th/9901001` / `math.GT/0309136v3`、可选 `.pdf` 后缀剥掉；容忍 `www.`）。抓取目标改为 `https://arxiv.org/html/<id>`；唯有 **404**——唯一表示「这篇没有 HTML 版」的回答——回退到粘进来的 URL 走普通路径。其它任何失败（403、传输错误）都是关于这次**请求**的事实，如实报告、绝不改道：在拒绝背后悄悄改抓 abs 页，等于把别人的拒绝页记在论文名下。粘进来的 `/html/` 链接本身就是升级版，绝不重写（不会循环）。升级 URL 也参与查重——同一篇论文在存过 HTML 版之后再粘 abs 链接是 `duplicate`，不是第二张卡。源记录存 HTML URL，刷新直接重抓好版本，不需要任何标记。
- **链接解析器**（`src/link-resolvers.ts`，表驱动，逐来源一个 resolver，网络 IO 注入所以模块可纯测）：resolver 回答三种之一——arXiv 候选、诚实的仅链接判定、或 `null`（不归我管，走普通路径）。
  - **doi.org**（`/10.<注册方>/…`）：Crossref（`api.crossref.org/works?filter=doi:<doi>&select=DOI,title,author`——单条作品路由实测拒绝 `select`，而完整作品记录可能超过抓取上限；带过滤的列表路由只回几百字节）给出标题与作者，然后向 arXiv API（`export.arxiv.org/api/query?search_query=ti:"…"`，无鉴权）只发标题**前六个词**的短语——短语搜索超过 6 个词就静默返回空（实测：AlphaGo 论文的 7 词前缀搜不到、6 词前缀能搜到；BERT 带冒号的 6 词短语能搜到），所以查准是闸的职责，不是查询的。候选必须过**双因子闸**才落地：归一化标题编辑相似度 ≥ 0.85，且两侧都有作者时至少一个姓重合（纯标题闸升到 ≥ 0.95）。作者因子存在的原因：纯标题闸实测会误中——Crossref 的 "Deep learning"（LeCun、Bengio、Hinton）与 arXiv 的 "Deep Learning"（Polson、Sokolov）标题相似度 1.0，却是两篇论文。**配不上就降级，绝不猜**：URL 回到普通路径，对 doi.org 就是那张诚实的「跨站跳转」仅链接卡。落地的候选把 arXiv HTML URL 存为源地址，论文标题作默认标签，粘进来的 DOI 记为源上的 `resolvedFrom`（详情页 kicker 会链它）。
  - **openreview.net**（`/forum?id=` / `/pdf?id=`）：完全不抓。把上面的实测事实直接回答出来：一张仅链接卡，带新的 `unreadable` 失败码——「这个页面是 JS 应用且有反爬，服务器端读不到」——句子里带着建议（如果它有 arxiv 版，直接粘 arxiv 链接 / 在浏览器打开）。猜论文、或把 SPA 壳存下来，都被拒绝。

`ReaderPreviewFailureCode` 新增 `unreadable` 给第二个 resolver 用：与 `blocked`（试过了，站点回了验证页）的区别在于这里什么都没试——宿主**知道**这个站服务器端读不了，句子直接说怎么办。与所有墙一样不可自动重试。

## Alternatives considered

**先抓再识别（旧形状）。** doi.org 的抓取按设计就是被拒的跨源跳转，所以「普通路径」对最常见的论文链接形式是注定的失败；而 OpenReview 的抓取返回 200 挑战页——正是当年变成卡片正文的那一页。对这些宿主，识别必须先于抓取。
**客户端解析。** 宿主拥有出网（`ctx.web` 是唯一 sanctioned 出口），解析一个 DOI 要两次 API 调用；浏览器侧解析器仍得搭宿主的抓取，还会把分类拆到进程两边——同一个状态两份推导，正是[抓取状态传播 bug](../bug-fix/2026-09-20-reader-fetch-state-propagation.md) 的病根。
**只用标题相似度做 arXiv 闸。** 实测是错的：短而泛的标题跨论文相撞（"Deep learning"）。作者重合因子让「配不上就降级」名副其实；没有它，闸就是在猜。
**经未来的 capture 包（M1）解析 OpenReview。** capture 在场时仍是计划——resolver 的仅链接回答就是 capture 缺席的分支，提案把渲染 forum 页取标题留给 M1。现在就把诚实降级做出来，卡片在有没有那个包时都是对的。
**feed 里的 arXiv 链接也升级（`fetchEntryBody` 路径）。** 刻意推迟：添加流程才是读者粘论文的地方，把 feed 条目的 arXiv 链接都升级会让自动补抓变成没人点开过的几百 KB 级 HTML 抓取。源级升级已覆盖刷新；feed 条目保留出版方 URL。

## Consequences

- 粘 arXiv 链接落的是论文（表格、MathML 公式——自 [MathML 放行](2026-09-20-reader-mathml.md) 起原生渲染）而不是摘要页；过闸的 DOI 落同一篇论文并标注来源；OpenReview 链接是诚实的卡片而不是挑战页。
- arXiv HTML 页超过出网缝默认的 100,000 字符上限（实测 384 KB），默认部署下走既有「内容未完整呈现」截断路径；部署侧 patch `maxBodyChars`（验收实例 64 MB）可解。升级让这个上限在主场景上**可见**，而不是偶发。
- DOI 路径每个链接多两次 API 请求，且是新的网络信任面：Crossref 与 arXiv 的回答都做防御性解析（JSON 解析失败、缺字段、截断一律降级回普通路径），任何 API 回答都绝不渲染——只有过闸的 id 变成 URL。
- `resolvedFrom` 进入源文档（可选字段，与其它字段一样归一化）；旧文档原样读取。

## Testing

`packages/dsh-reader`——新用例都先对着改动前的代码红过：

- `tests/host-pure.spec.ts`：arXiv id 的各种形状（abs/pdf/html、版本、旧式、`.pdf` 后缀、`www.`）、非论文页拒绝、升级映射；DOI 匹配形状；标题归一化与编辑相似度闸（归一化后相同、副标题漂移、"Deep learning" 近似碰撞）；作者姓重合；resolver 表对 fixture 载荷（Crossref JSON、arXiv Atom）的 DOI 与 OpenReview 回答，含 Crossref 404、截断 JSON、空搜索与被闸掉的候选。
- `tests/boot.spec.ts`：abs → 抓取并存储 HTML URL（abs 从未请求）；带版本与后缀的 pdf；404 回退粘贴 URL；403 **不**回退；粘贴的 `/html/` 链接按原样抓；同一篇论文的第二种 URL 判重。DOI 端到端（脚本化缝）：过闸命中落 HTML URL、标题标签与 `resolvedFrom`；被闸掉的标题走普通路径。OpenReview 存仅链接、`unreadable`、且缝从未被调用。
