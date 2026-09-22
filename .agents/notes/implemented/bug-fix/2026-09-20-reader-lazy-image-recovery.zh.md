# Agent Note：读者现在能回收懒加载图片

Status: implemented

## Problem

抽取器以前只读 `<img>` 的一个属性：`src`。而懒加载站点在 `src` 里放的是 1px 的 `data:` 占位图（或者干脆没有），真 URL 在旁边一格——`data-src` 及其同类属性、`srcset`、`<picture>` 的 `<source>`、或者 `<noscript>` 的 no-JS 兜底里。抓取不执行脚本，所以那份静态标记是读者能拿到的**唯一**一份，而归一化把它扔了：`data:` 按 scheme 被拒、`<noscript>` 在 `DROP_TAGS` 里打分前就被整棵移除、`<picture>` 被拆包（里面的回退 `<img>` 随后多半死于占位 `src`）、`srcset` 从未被读过。详情页输出的还是裸 `<img>`，防盗链的 CDN 对它就答 403。（读者可见的症状挨着[状态边界 note](../architecture/2026-09-19-reader-state-boundaries.md) 引用的那个脚本图缺口：被报上来的那篇论文有 27 张无尺寸图片。）

## Decision

都在 `client/extract-article.ts`：

- **`<img>` 的候选顺序**：先真正的 `src`（那里是 `data:` URI 就是经典占位图，按**没有**计），再懒加载属性（`data-src`、`data-original`、`data-lazy-src`、`data-url`、`data-actualsrc`——刻意保持紧凑的一张表），再 `srcset` 里最大的候选（`w` 与 `x` 描述符都按数值排）。全都没有才丢图。
- **`srcset` 不天真按逗号切**：`data:` URL 自带逗号，被切开后它的 payload 尾巴会解析成一个**能赢**的候选。先把两半拼回去（拼回的候选随后照旧按 scheme 被拒）。
- **`<picture>` 归一成一张 `<img>`**：第一个可用的 `<source srcset>`，否则回退 `<img>`（两种走法都沿用它的 `alt`）。白名单里没有 picture/source，留着包装只会在复制一张图和丢掉它之间二选一。
- **`<noscript>` 移出 `DROP_TAGS`**，由归一化处理：里面若有 `<img>`——标准的 no-JS 兜底——就把那张图回收；noscript 带的其它一切（「请开启 JavaScript」）照旧丢弃，行内摘要里也一样。禁脚本解析（抓取拿到的就是这种；已在 jsdom 里验证）下其内容是元素，启用脚本解析下是文本，两种形状都处理。
- **打分不计 noscript 里的 `<img>`**：那是标记里已有图片的兜底副本，不是第二张图。
- **归一化输出的每个 `<img>` 都带 `referrerpolicy="no-referrer"`**——是输出时加的，不是从站点抄的：读者这边本来就没有可供 refer 的页面上下文，而懒加载站点恰恰多用防盗链 CDN。
- **`scriptFigures` 语义不变**：图片只在运行时存在的 figure（空容器 + 图注）照旧产生那行提示。这条修复画的分界正是「URL 就在静态标记里」与「页面自己画它」之间。

## Alternatives considered

**懒加载图片就丢着，像脚本图一样说一句。** 脚本图的提示存在是因为那种 genuinely 拿不回来；`data-src` 里躺着的 URL 不是。只有把两者当成一回事处理，它们在读者眼里才是一回事。
**让宿主把图片抓下来内联。** 宿主的缝对正文有上限，每张图再抓一遍还会把请求翻倍；回收 URL 不花任何代价，浏览器自己会去加载。
**按完整的 HTML 规范算法解析 `srcset`。** 这里的排序（描述符数值、裸 URL 最小）只对本来就非法的标记（一个列表里混 `w`/`x`）才可能错；data URI 拼回是唯一真实出现的情况。
**打分阶段保留 noscript 在 DROP_TAGS、归一化时再回收。** 做不到：打分前的剥离会把子树从归一化要走的文档里删掉。打分真正多看到的是 noscript 很少携带的一点点文本，以及现已跳过重复的图片计数；两个真实页面 fixture 抽出的正文逐字节不变。

## Consequences

- 懒加载站点（现代 web 的一大块）的文章现在带着图到达；CDN 的 403 随 `no-referrer` 一起消失。
- 图片唯一的标记副本是 noscript 兜底的 figure，不再被计为脚本绘制——这是对的，因为图现在真的渲染了。
- 打分器现在看得到 noscript 子树（打分前不再剥离它们）。它们的常见内容——一张图、没有散文——动不了分数，而图片计数明确跳过重复副本；两个真实页面 fixture 抽出的正文逐字节不变。
- 只有 `data:` URI 的图（没有懒加载属性、没有 srcset）照旧被丢——结果和从前一样，只是换了条路到达。

## Testing

`packages/dsh-reader` 共 271 个测试（+10）：`tests/extract-article.spec.ts` 里每条回收路径各一个用例（懒加载属性、`data:` 占位的穿透、srcset 的宽度与倍率两种描述符、data URI 的逗号、picture 的 source 与回退、noscript 回收、不是图的 noscript、输出标签上的 referrerpolicy），外加「脚本绘制图提示不变」的回归。两个真实页面 fixture 抽出的正文不变。
