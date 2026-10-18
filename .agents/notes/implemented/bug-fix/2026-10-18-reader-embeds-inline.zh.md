# Agent Note: dsh-reader 内联渲染内容嵌入件（沙箱框架、原生媒体）

Status: implemented

## Problem

[占位链接的决策](2026-10-18-reader-embed-placeholder-links.md)用「点链接去别处看」回答了「图表消失了」——那是诚实的下限。读者接下来的问题顺理成章：图为什么不能直接在那里？当初拒绝 ifame 的理由（「正文绝不承载 iframe」）形成于实测之前；而今天的 web 实际投送的内容是：读者会遇到的嵌入件（Anthropic 的 artifact 图表、YouTube 播放器）就是为被 frame 而供的——那篇文章的 16 个 artifact 都没有 `X-Frame-Options`/`frame-ancestors`（2026-10-18 验证），源页面自己也以 `sandbox="allow-scripts"` 嵌入它们。

## Decision

`embedElement`（`src/client/extract-article.ts`）现在**保留**内容嵌入件，而不是链接它：

- **iframe → 沙箱框架**：`sandbox="allow-scripts"` 且永不含 `allow-same-origin`——框架里的脚本运行在不透明源上，看不见面板、不能弹窗、不能跳转顶层，与源页面自己用的约束完全一致——外加 `loading="lazy"` 与 `referrerpolicy="no-referrer"`。题注链接留在框架下方，作为加载失败时的出口。尺寸取自页面：包装器的比例盒（`padding-bottom: N%`，Anthropic ArtifactEmbed 的形态）转成 `aspect-ratio`，其次用框架自己声明的宽高，否则用面板默认高度。固定比例还意味着框架加载后不再撑长文档——「图片无尺寸」的阅读位置漂移不会从这扇门回来。
- **video/audio → 原生 `controls` 播放器**，`preload="none"`：媒体元素不跑脚本，autoplay 被剥掉，读者不按播放就一个字节也不下载。`poster` 经 scheme 校验后保留。
- 追踪器门槛不变，只是现在守的是一次加载而不是一个标签：隐藏或像素级的嵌入照旧丢弃，无 title 的 iframe 必须声明内容级尺寸（宽高均 ≥200px）。

面板的正文样式承接这些框架（`.article [data-reader-embed]`，`ReaderPane.module.css`），接缝两侧的信任注释都改写成同一条规则：正文绝不带脚本、样式、表单、事件属性——留下的嵌入件要么是不透明源的沙箱框架，要么是只有控制条的播放器。

## Alternatives considered

**占位链接（降级为题注，不再是答案）。** 它把图表丢给一次点击——正是读者不满意的地方——但它留在每张框架下方作为失败出口。作为主要渲染方式被取代，但没有删除：[占位链接笔记](2026-10-18-reader-embed-placeholder-links.md) 仍持有门槛的论证与「capture 救不了跨域框架」的论证，两者依然成立。

**`sandbox=""`（不给 allow-scripts)。** 这些 artifact 的内容就是脚本画出来的——全静默沙箱恰好在我们要修的页面上渲染出空白盒子。

**抓取时给每个框架截图。** 得到的是真像素、无活内容——但需要 capture 包在场，把互动图表变成死图，且每帧一次无头渲染。沙箱框架是活的、可交互、零成本。

## Consequences

- Anthropic 改版后的那篇文章现在内联渲染全部 16 张图表和那段视频（已从 localhost 源端到端验证：框架载入、脚本运行、渲染出源页面同款网格）。YouTube 式有尺寸无 title 的嵌入按尺寸内联。
- 信任边界移动了：第三方脚本现在会执行，被 sandbox 属性关在不透明源里。读者自己添加的恶意订阅源最多 frame 一个「嵌入件」在它自己的运行时里空转——摸不到面板、面板的存储、面板的导航。想静默加载的追踪器仍在门槛处被丢弃。
- 按占位规则存下的旧正文保持链接形态，直到「重新抓取」；不会因此损坏。
- 测试：`tests/extract-article.spec.ts` 钉住框架形态（sandbox 标志、lazy、no-referrer、来自包装器与来自声明尺寸的 aspect-ratio）、原生播放器（src 或 `<source>`、poster、`preload="none"`、剥掉 autoplay）、追踪器丢弃、figure 计数排除、以及恶意 src 的拒绝。
