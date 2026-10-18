# Agent Note: dsh-reader 把嵌入内容（iframe/video/audio）变成占位链接

Status: implemented

## Problem

2026-10-18 的用户反馈：self-replicating-ai 这篇文章的图表「还是没抓全」（题图嫁接修复之后）。原因是页面本身改版了：图表全部改成**沙箱化的跨域 iframe 嵌入件**——共 16 个（`assets.claude.ai/.../NN-*.html`，互动图表/表格），外加一个 `<video>` 图。提取器此前把这三个标签整棵丢弃（`DROP_TAGS`），于是正文里「See the table below」下面什么都没有，出现 16 次。而且没有任何提示：`countScriptFigures` 只数 `figure` 元素，这些嵌入件包在普通 div 里。渲染抓取也救不了——跨域 iframe 的文档对顶层框架在原理上就不可达。

## Decision

`iframe`、`video`、`audio` 移出 `DROP_TAGS`（`src/client/extract-article.ts`）；`normalizeNode` 把它们交给 `embedLink`，在原地发出**占位块链接**（`<p data-reader-embed="…"><a href target="_blank" rel="noopener noreferrer">标签</a></p>`）——标签取嵌入件自己的 `title`，没有就取来源 host。追踪器门槛把信标挡在外面：隐藏（`display:none`/`visibility:hidden`）或像素级（≤2px）的嵌入一律丢弃；无 title 的 iframe 必须声明内容级尺寸（宽高均 ≥200px，YouTube 式嵌入能过、追踪壳过不了）；video/audio 凭可解析的 `src`（或 `<source src>` 子元素）即合格——文章正文里的媒体文件从来不是信标。

周边规则同步对齐：`countScriptFigures` 把含 `iframe[src]`/`audio` 的 figure 视为有内容（占位链接就是它的「图」——再计数只会让渲染抓取为一个它修不了的东西空跑）；`trimLeadingChrome` 在开头遇到嵌入件即停（文章完全可以以一段视频开场）；`serializeInline` 跳过嵌入件，卡片摘要保持干净。面板把 `[data-reader-embed]` 画成带 ↗ 的边框块（`ReaderPane.module.css`），详情页的信任注释也改口：正文里不存在活框架，只有它们的链接。

## Alternatives considered

**保留 iframe 直接渲染。** 违反白名单的立身规则：正文绝不跑第三方脚本，而 `allow-scripts` 沙箱框架恰恰就是。阅读面板把正文渲染成 DOM 文本（段落引用功能赖于此），承载活框架等于把它拆掉。

**计为脚本绘制图、交给渲染抓取。** 渲染抓取序列化的是顶层文档；跨域 iframe 的内容是另一个文档，父页面读不到。触发一次要约 15–30 s 且什么都改变不了——一个不能工作的控制不如没有。

**抓回 artifact 并内联它的图表。** 每个 artifact 都是自带脚本的独立页面；内联等于把白名单存在要防的注入面放大十六倍重新引入。

**不加占位、只给一条横幅。** 按文章的提示说不出这 16 个洞各自在哪里；原地链接既是提示也是出口。

## Consequences

- Anthropic 式 artifact 页面现在能读全：每张图表/表格/视频都在原地留下带标题的链接（反馈页面实测 17 个占位，对线上 HTML 验证过）。读者点一下就在浏览器里看到活的它。
- 此修复之前存下的正文维持原样，直到「重新抓取」——`repairStoredBody` 复原不了从未入库的标记。
- 门槛可能误判两次：既无 title 又无尺寸的内容 iframe 仍会被丢（实测罕见：发布方的嵌入两者必有其一）；带 title 的追踪器则会留下一个无害链接（无脚本、不加载——只有读者点击才会解析这个 URL）。
- 测试：`tests/extract-article.spec.ts` 钉住占位形态（带 title 的 iframe、经 src 与经 `<source>` 的 video、有尺寸无 title 的 YouTube 式 iframe）、追踪器丢弃（隐藏 / 1×1 / 无 title 无尺寸 / `javascript:` src）、figure 计数排除、行内摘要跳过；既有的「`<iframe>` 绝不幸存」注入断言原样保持绿色。
