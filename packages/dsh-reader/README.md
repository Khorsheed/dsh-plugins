# @khorsheed/dsh-reader

阅读器：右侧栏一个**页面型 tab**，把 RSS/Atom 订阅和随手粘贴的文章链接收在同一个卡片流里。点卡片在 dsh 里直接读正文（可划选引用），正文受宿主抓取上限截断时明说"未完整呈现"并给一个去原文的按钮。

抓取在**宿主半**完成（走 `ctx.web` 这条官方出网缝），浏览器半只做解析和渲染；订阅清单与最近一次抓回的原始 payload 落在 `$DSH_HOME/state/dsh-reader/state.json`，每日按点自动刷新（插件自带 `setTimeout`，不是宿主服务）。

## 三个面

| 面 | 内容 |
| --- | --- |
| 列表 | 一卡一条：来源瓷砖 + 标题 + 摘要 + 标签/作者。未读是瓷砖角上一个**圆点**（7px，会话级、不落盘）。顶部有搜索框、只看未读、三种排序（最新/最早/按来源），三者都是本地谓词，不发请求 |
| 详情 | 点卡片进来。正文以 DOM 文本渲染——**这正是划选引用能工作的原因**，也是这个面不放 iframe 的原因。工具条：返回、复制链接、在浏览器打开原文。正文下面列"同一来源"的其他条目 |
| 新增 | 粘贴订阅源地址或任意文章链接。**存成什么由抓回来的内容决定**（D15）：是 feed 就建订阅，是网页就只存这一篇——避免把一篇随机网页存成一个永远为空的订阅源。抓取失败时把宿主缝自己的原话显示在判定下面（不是只有一句「抓取失败」）；左上角有返回列表的箭头 |

**点击语义（定案方案 B）**：点卡片 = 进详情页。大多数阅读在 dsh 里完成；正文太长或想直接看原文时，详情页自己的按钮会跳浏览器。卡片尾部的箭头是"这里能进"的提示，不是控件。

## 引用

正文是应用级选区，所以 `@khorsheed/dsh-quote` 的浮层菜单**本来就覆盖它**——本插件不自己造选区菜单。详情页底部另有：

- **引用**：选区（没选区就是整条）+ 来源标签，经官方输入机合成进当前会话草稿（读现有草稿合并，绝不覆盖、绝不发送）；
- **引用到侧边对话**：只有组合里真有 `sideChat` 服务时才显示（能力握手说了算），否则这一项隐藏。

`reader` 自带一个薄 typert Remote（namespace `reader`），verb：`capabilities` / `listSources` / `addSource` / `updateSource` / `removeSource` / `refresh` / `getBodies` / `quoteToSideChat`。宿主半**不解析** feed——解析在浏览器半，`getBodies` 只把原始 payload 交过去。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-reader
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-reader
```

装完重启宿主。落盘只有一处：`$DSH_HOME/state/dsh-reader/state.json`（订阅清单 + 最近 payload）。卸载后这个文件会留下——想彻底清干净就删掉它。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——`sidebar.right.pane.tab` 座位、`ctx.web.fetch` 出网缝、`ctx.fs` 版本守卫写、`pluginInventory` 都不需要（本插件不做 preset 自隐）。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）
- **宿主抓取上限是已知限制**：`ctx.web.fetch` 把解码后的正文截到 100,000 字符且**静默截断**。超限的文章抽不全（实测：Anthropic 研究页 ~266k、theverge.com ~899k、newyorker.com ~1.97M 字符）；摘要页里的文章标题、作者、摘要仍然在。详情页会因此显示「受限篇幅，内容未完整呈现」+「阅读原文」。RSS 源基本安全（实测：HN 11KB、BBC 25KB、阮一峰 69KB、Simon Willison 83KB——83KB 已经贴着上限）。
- **降级矩阵**：无 `fs` → 状态只在内存里、重启即丢（握手会 `hasFs: false`，不假装有持久化）；无 `web` → `addSource` 返回 `unsupported-content`/`fetch-failed`，不抛异常；无 `sideChat` → 侧边对话那一项隐藏；无 `quote` → 选区浮层缺席，但条目级「引用」按钮照常工作。
- **跨源重定向不跟随宿主自动跳**：宿主缝会拒跨源跳转（`WEB_REDIRECT_BLOCKED`），本插件自己最多跟 3 跳、每跳重新进缝，所以常见短链/换域名订阅源仍能订阅。
- **不做条件请求**：宿主缝没有自定义请求头入口，所以没有 ETag/If-None-Match，每次刷新都是完整抓取。
- **订阅登录墙后面的内容：不做**。没有凭证注入面。

## Known Limitations

- **只订阅、不抓文**：新增订阅时只抓 feed 本身，不会为每条目预抓正文（存储会爆，而且那是在当爬虫）。想看某条正文时点开它，付一次抓取。
- **未读与正文不落盘**：会话级状态。持久化逐条已读游标需要第二份写密集文档，而"自上次看过以来有什么新的"本身就是这个插件的价值所在。
- **XML 解析在浏览器**：宿主侧没有 XML/DOM 解析器（`globalThis.DOMParser === false`），所以 feed 解析必然在客户端。
- **不依赖 browser-pane**：`proposals/active/2026-09-13-browser-pane.md` 还是 planned，而且 canvas 的 CDP 帧里承载不了划选引用。
