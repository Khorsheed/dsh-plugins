# Reader 插件重写设计（定稿）

Date: 2026-09-17
Status: **定稿，待实施（S1 起）**
Branch: `feat/reader`（worktree `.worktrees/reader`）
Package: **`@khorsheed/dsh-reader`**（原 `@khorsheed/dsh-rss-reader`，0.1.0，已废弃）
Supersedes: `.agents/notes/proposed/feature/2026-09-17-rss-reader-legacy-note.md`（旧 note 声称
"implemented"，但落地物是一个 `RssView` 直接 `return null` 的空壳 —— 已随包一并丢弃并归档为历史证据）

配套侦察报告（同目录，全部带 file:line 依据）：

- `2026-09-17-rss-reader-host-seams.md` —— 宿主可用的抓取 / 落盘 / 定时 / Remote / XML 面
- `2026-09-17-rss-reader-patterns.md` —— 仓库内可照抄的右栏 tab 惯例
- `2026-09-17-rss-reader-selection-quote.md` —— 选区引用机制（含两处关键否定结论）

---

## 0. 结论先行：旧代码丢弃、改名、重做

旧 `packages/dsh-rss-reader` 从未进过 git（`git ls-files` = 0），是一个从没实现过却被打包上线的壳。
关键缺陷（完整 21 条见 patterns 报告 §7）：

| # | 症状 | 证据 |
|---|---|---|
| 1 | **点开没内容** —— tab body 直接返回 null | `src/client/RssView.tsx:9-13`；生产装的那份 tarball 里也是 `function RssView(_props) { return null; }` |
| 2 | 探的服务不存在：`ctx.get('fetch')` 恒为 `undefined` | `src/remote.ts:105`；宿主无任何 key 为 `fetch` 的服务 |
| 3 | `FsMirror` 是编造的 API，且 store 从未调用它 | `src/remote.ts:35-44` vs 宿主 `packages/fs/fs/src/index.ts:116-277` |
| 4 | 5 个动作里 2 个返回字符串 `'Not implemented in this build stage'` | `src/remote.ts:118,124` |
| 5 | 4 处 `catch { /* 静默 */ }` 吞掉真实组合错误 | `src/client/index.ts:19-46` |
| 6 | `slots.inject` 回调写成 `async`，且注册缺 `store`/`inject` | `src/client/index.ts:37-42` |
| 7 | 测试只有 3 个字符串工具断言，无组件渲染断言 | `tests/rss-reader.spec.ts`（17 行） |

唯一可救的是 `types.ts` 里 3 个纯函数（约 20 行），已随备份归档，不移植。

**已备份**：`$DSH_HOME/scratch/rss-legacy-backup-20260917/`。

---

## 1. 产品定义

一个**链接阅读器**，不只是 RSS 阅读器：

- **订阅源**：RSS 2.0 / Atom，每日定时抓取，落盘；
- **手动链接**：粘贴任意文章 URL，立刻抓取入库；
- **阅读形态**：卡片流 → 点卡片 = 系统浏览器打开原文；卡片上「查看更多」= 面板内详情（可划选引用）；
- **引用**：划选引用、整条引用、复制链接，全部走官方面，不依赖 `quote`/`sidechat` 编译期存在。

---

## 2. 决策清单

### D1 — 身份：`@khorsheed/dsh-reader`

改名牵动**身份三元组**（`package.json` 的 name / `cordis.patch.yml` 的 loader id /
`tsdown.config.ts` 的 `clientBundle(id)` / `src/invariant.ts` 的 `PACKAGE_NAME`）必须同名联动。连带：

- 目录 `packages/dsh-rss-reader/` → `packages/dsh-reader/`
- `scripts/gen-typert.mts` 的 `TYPERT_PACKAGES` 条目改名
- 状态目录 `$DSH_HOME/state/dsh-reader/`
- `docs/packages.md` 由 `pnpm map:packages` 重生成（**不手改**）
- **生产 profile 里旧的 `@khorsheed/dsh-rss-reader` 行必须摘掉** —— 它在
  `$DSH_HOME/profiles/web/package.json` 的 `dependencies` **和** `dsh.profile.bundles` 两处，
  同包换名 = 配置变更；由 `pnpm deploy:3080 --package packages/dsh-reader` 走完整流程处理，
  不手工编辑 profile（仓库规矩：只有 flow 写 profile）
- 旧 npm 包 `@khorsheed/dsh-rss-reader@0.1.0` 标弃用（不 unpublish）

### D2 — 抓取分路：宿主 `ctx.web.fetch` 是唯一通道，尊重 10 万上限

**用户已确认：按宿主上限来。** 所以：

- **全部抓取走 `ctx.web.fetch`**（`ctx.web.fetch({url}, signal)` → `{url, statusCode, body:{kind,content}, truncated}`），
  这是宿主唯一的出网许可面，它自带公网地址解析与连接固定、字节上限 5 MiB、超时 30s、重定向跟随。
- **不使用 `globalThis.fetch`** —— 那会绕开宿主的公网校验与连接固定。放弃它换来的是边界干净，
  代价是下面这条已知限制。
- **已知限制（写进 README，不藏）**：`web-fetch-http` 的 `maxBodyChars` 默认 **100,000**，本 profile 无覆盖。
  超过即**静默截断**（`truncated: true`）。实测：Anthropic 研究页 266,563 字符、theverge.com 899,105、
  newyorker.com 1,966,642 —— 这类站点抽不到正文。RSS 源本身实测全部安全（HN 11 KB / BBC 25 KB /
  阮一峰 69 KB / Simon Willison 83 KB）。
- 截断 / 解析失败 / 抽取失败时的行为见 D6。

### D3 — XML/HTML 解析与抽取都在客户端

**宿主没有 XML 解析器**（Node 22 实测 `globalThis.DOMParser === false`），全生态无 XML 库，宿主也没有
可调用的正文抽取服务（`tool-web` 的 turndown 是它私有的、面向 LLM 的文本转换）。所以解析器只有一份：

- 宿主只负责**抓取 + 落盘原始载荷**（RSS 的 XML / 文章的 HTML）与元数据；
- 客户端 `DOMParser` 解析。**RSS 用 XML 路径**（`<item>` / `<entry>`，含 `<content:encoded>`）；
  **网页用 HTML 路径**（可读性打分抽正文）。

**零新增运行时依赖**（全仓 37 个包只有 `zod` 一个 runtime dep），**且没有 XSS 面** ——
我们不用 `innerHTML`，是构造 React 元素，`script` 永不执行，不需要 sanitizer 依赖。

### D4 — 正文抽取：分块打分，语言感知

真 Readability 的做法是逐块打分再向上传播。我们要复刻它的核心信号，并补一个它没有的：

- **信号**：段落质量（长段落数 × 长度）、文本总量、**扣掉链接质量**（链接密集的块是导航/目录，不是正文）、
  `article`/`main` 加权、**"只是包着更好子节点"的容器降权**（实测：不加这条会抓到页面容器，
  473 个 `<p>` / 56 张图）。
- **语言感知（必须）**：中文一篇 300 字可以是一整段，英文 300 字是一大段，**同一阈值必然错一边**。
  所以段落合格线、标点密度（中文数 `，。！？；：`，英文数 `,;`）分别判定。这是本轮实测暴露出来的：
  同一个抽取器在英文那篇抽出了干净正文（40,929 字符 / 54 段），在中文那篇抓到了整个页面容器。
- 剥离 `script/style/noscript/nav/header/footer/aside/form/iframe/svg/button` 与媒体播放器等子树。

### D5 — 正文渲染：React 元素 + 中英分开的排版规范，不用 iframe

**不用 sandboxed iframe。** 理由：iframe 里的文字 `window.getSelection()` 读不到，
**划选引用会直接失效**；而发布方原样排版在 300px 侧栏里本来也是崩的。

抽取后的元素映射成受控白名单后渲染成 React 元素（`p/h2/h3/ul/ol/li/blockquote/pre/code/strong/em/a/img/table/...`），
属性只留 `href`/`src`/`alt`。

**排版规范（中英必须分开，这是本次定稿的交付物之一）：**

| 项 | 中文 | 英文 | 理由 |
|---|---|---|---|
| 行高 | 1.78 | 1.66 | 汉字无词间空隙，行距不足即糊；这是中英最不能共用的一项 |
| 字距 | `+0.005em` | `-0.003em` | 中文字面带白；西文需轻微收紧 |
| 行宽 | `max-width:40em` | `max-width:62ch` | 面板拖宽时正文不拉成长条 |
| 字号 | 13.5px 基准 | 同 | 与侧栏其它面板 11~13px 拉开一档 |
| 段距 | 12px，**段距制不缩进** | 同 | 与卡片式界面相配 |
| 层级 | h2 15px/700，h3 13.5px/700 | 同 | 只靠字重与留白分层，窄栏里不靠字号阶梯 |
| 引用 | 3px 左边框 + 弱化色，**不做背景块** | 同 | 300px 时背景块吃掉半屏 |
| 换行 | `text-wrap:pretty` + `overflow-wrap:anywhere` | 同 | 周刊类文章长 URL 是常态 |

### D6 — 详情页内容与"没抓完"的提示

- 详情页渲染**抽取出的正文**。
- **截断 / 抽取失败 / 超上限**任一发生：正文渲染到可用处即止，**文末固定一块提示**：
  「更多内容请查看原文」，点击 → **系统浏览器打开原文**（打开路径见 D12 的探针）。
- 不再尝试"面板内渲染原样网页"，也不引入浏览器面板依赖（见 D12）。

### D7 — 粘贴链接：粘贴即抓，点进去即可读

用户要求"复制的链接进来快速抓取到原文，点进去就能查看"。所以：

1. 在粘贴框按回车 → 立刻 `addSource({url})`（宿主抓取 + 入库，状态 `fetching`）；
2. 卡片立即出现，带"抓取中"状态，标题先用 URL 的 host + path 兜底；
3. 抓取完成 → 卡片换成真实标题 / 摘要 / 来源 / 日期（宿主返回原始 HTML，客户端解析元数据）；
4. **全文抽取也在抓取完成时同步做掉**（客户端，本地，几十毫秒），所以**点「查看更多」时正文已经就绪**，
   不会出现"点进去还要等"。正文只在内存，不落盘（D8）。

失败路径：抓取失败 / 被截断 / 抽取为空 → 卡片明确显示状态，详情页给 D6 的提示块。

### D8 — 存储：三层，只有第一层落盘

| 层 | 内容 | 生命周期 | 上限 |
|---|---|---|---|
| 持久 | 源列表 + **每个源最后一次的原始载荷**（RSS XML / 链接 HTML）+ 抓取元数据 | 跨进程 | 单源 256 KiB、总量 2 MiB，超了先丢最旧源的载荷 |
| 内存 | 解析后的条目、**抽取出的正文** | 会话内 | 随用随弃 |
| 会话 | 未读游标、筛选、选中项、抓取中状态 | 会话内 | 不落盘 |

**明确不做**：给每条条目预抓全文。单篇正文 100~300 KB，100 篇就 20 MB+，而且那等于自建爬虫轰人家站点。
代价（写进 README）：重启后未读重置、离线不能再读已读文章。

落盘照抄 `SideChatStore`：`ctx.inject(['fs'], ...)` **延迟注入**（apply 期 `ctx.get('fs')` 会永久降级成
内存态 —— 这是 3080 上发生过的真事故）、一个版本守卫的 `state.json`、损坏文件**拒绝而非覆盖**、
无 fs 时内存降级并记一次日志。state 根：config → `$DSH_HOME/state/dsh-reader` → `<cwd>/.dsh-reader`。

### D9 — 每日刷新：插件自有定时器

宿主**没有**调度服务（`ctx.timer` 只有 fiber 级 `timeout/interval/throttle/debounce`；`dsh-schedule`
是 agent/session 提醒，Web profile 未挂载）。所以：`setTimeout` 到 `refresh.timeOfDay`（默认 10:00）下
一次出现，跑完重排；**启动补刷**（`lastRefreshAt` 早于最近一次计划时刻则立刻刷），这才是"每日刷新"
在进程重启 / 机器休眠后仍然成立的原因。清理走 `ctx.effect(() => () => clearTimeout(h), ...)`
（本 cordis 版本**没有** `ctx.on('dispose')`）。

### D10 — 表面与交互

- 右栏 tab，两段式注册，两段都走 `ctx.effect`：
  `ctx.sidebarRightTabs.register(definition(t))` + `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({name, key: TAB_ID, locale, store, inject}, ReaderTab))`。
  铸造新 kind `'reader'`；页面型 tab 不声明 `patterns`/`canOpen`，`priority` 保持默认 `extension`；
  guide 条目 `order: 60`。
- **卡片流**：`grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))` —— **纯 CSS 自适应，不用容器查询**。
  右侧栏宽度实测 300px ~ 框架 70%（默认 45%），所以列数必须跟随面板宽度。
- **卡片字段**（用户选定）：来源名 + 图标、相对时间、作者、标签、摘要两行、未读点、**「查看更多」入口**。
- **点击语义（用户确认）**：卡片主体 → 系统浏览器打开原文；卡片上「查看更多」→ 面板内详情。
- **详情页**：顶栏 `返回 / 复制链接 / 打开原文`；正文（D5 排版）；文末 D6 提示块。

### D11 — 图标：源自带优先，否则字母块；**不接第三方 favicon**

宿主的抓取 seam 只解 `html`/`text`（`WebFetchBody` 是封闭联合，**没有二进制分支**），所以宿主根本
搬不回图片；唯一的路是让 `<img src>` 直连 favicon 服务 —— 那等于**面板每开一次就把订阅列表泄露给
第三方一次**，与"本地隐私阅读器"的前提直接冲突。所以：

1. 源自己声明了 `<image><url>` / `<icon>` / `<logo>` → 用它（发布方自家资产）；
2. 否则按域名生成稳定字母块（首字母 + 定色）。零网络、永不裂图。

### D12 — 不做浏览器面板依赖

`proposals/active/2026-09-13-browser-pane.md` 状态仍是 **planned**：全仓无 `packages/browser`、
无 `packages/ui-browser`，M0 探针未做，且 `ctx.webServer.registerUpgrade`（WS 升级）在已发布社区包里
**尚无任何消费者**。它的渲染是**canvas 上的 CDP 帧流，不是 DOM**，所以里面的选区 quote 读不到，
要在浏览器面板里划选引用必须另造一条 CDP 选区通道。

而且它唯一不可替代的能力（任意站点 / 登录态）**用户自己的浏览器已经有了**。所以 Reader v1
不以它为前置；将来它落地后，可作为"抽取失败的站点"的增强入口，届时再补选区通道。

**打开路径现状（必须探针验证，不许假设）**：宿主**没有**面向插件的"用系统浏览器打开 URL"的通用服务
（已排查 `open-in-app` / `webServer` / `web` 三面；`file-preview` 的 `openExternal` 是本地文件的
`open -a App`，不含 URL）。S0 的第一个动作就是**最小探针**：在 3080 上确认 `<a target="_blank" rel="noopener">`
的实际行为，若不可用则退到 `ctx.webServer` 加一条自己的打开路由（并在 README / compat 里记录）。

### D13 — 引用：全部走官方 composer，选区交给 quote 插件

- **整条引用**（官方 composer 路径，零可选依赖）：
  ```ts
  const scope = ctx.sessions.scope(sessionId)
  const input = scope?.get('conversation')?.input.for(scope)
  if (input === undefined) return                 // 降级：无会话表面
  input.setDraft(mergedQuoteDraft(input.state.getSnapshot().draft, block))
  ```
  `setDraft` 是**整份替换**，所以必须先读现值再合并（`mergedQuoteDraft` / `formatQuoteBlock` 照抄
  `packages/quote/src/types.ts`，约 30 行）。
- **划选引用**：**不自造浮层**。`quote` 插件已有一个全框级选区菜单
  （`shell.overlay`：引用到当前会话 / 引用到侧边对话 / 复制，`packages/quote/src/client/SelectionMenu.tsx:98-132`），
  它只排除可编辑区与自己根节点，所以详情页正文天然可用。自己再做一个会在同一次选中里
  **弹出两个菜单**（已验证 `quote` 没有退让开关），还会白丢"选中即复制"、多背约 200 行。
  降级：`quote` 缺席时划选引用不可用，但详情页的整条引用按钮仍在。
- **侧边对话**：本插件自己的 Remote → 宿主探测 `ctx.get('sideChat')` → `openWith({...})`；
  服务缺席返回 `'unavailable'`，客户端隐藏按钮。`sidechat` 只进 `dsh.references`，**不编译期依赖**。

---

## 3. 数据模型

```ts
/** 一个源：订阅源，或一条手动保存的链接（手动源恒定只有一条 entry）。 */
interface ReaderSource {
  id: string
  kind: 'rss' | 'link'
  url: string                      // rss: 源地址（重定向后规范化）; link: 文章地址
  label?: string
  enabled: boolean
  addedAt: string
  fetchedAt?: string
  status?: 'ok' | 'error' | 'fetching'
  error?: string
  truncated?: boolean              // 上次抓取被宿主 10 万字符上限截断
  raw?: string                     // 最后一次的原始载荷（RSS XML / 文章 HTML）
}

interface ReaderStateDoc {
  version: 1
  sources: ReaderSource[]
  refresh: { enabled: boolean; timeOfDay: string }   // 'HH:MM'
  lastRefreshAt?: string
}

/* ── 客户端解析产物（不落盘） ───────────────────────────────── */
interface ReaderEntry {
  id: string                       // 稳定 id：guid/link，回退 title+link 哈希
  sourceId: string
  title: string
  link?: string
  author?: string
  publishedAt?: string
  tags?: string[]
  summary?: string                 // 卡片用
  contentHtml?: string             // 详情页用：RSS 的 <content:encoded> 或抽取出的网页正文
  truncated?: boolean              // 正文不完整 → 详情页出 D6 提示块
}
```

---

## 4. 线上面（`TypertRemoteService` + `@Remote`，namespace `reader`）

宿主方法返回**裸值**；wire 层加一层 `RemoteResult` 信封；领域拒绝是信封**内部**的带标签联合，
**绝不双层嵌套**（旧代码就错在这里）。

| verb | 请求 | 裸返回 |
|---|---|---|
| `capabilities` | — | `{ protocolVersion: 1; hasFs: boolean; hasSideChat: boolean; nextRefreshAt?: string }` |
| `listSources` | — | `{ sources: ReaderSourceSummary[] }` |
| `addSource` | `{ url: string; label?: string }` | `'ok' \| 'invalid-url' \| 'duplicate' \| 'unavailable'` |
| `updateSource` | `{ id; enabled?; label?; timeOfDay? }` | `'ok' \| 'not-found' \| 'unavailable'` |
| `removeSource` | `{ id: string }` | `'ok' \| 'not-found' \| 'unavailable'` |
| `refresh` | `{ ids?: string[]; manual?: boolean }` | `{ results: Array<{ id; status: 'ok'\|'fetch-failed'\|'truncated'\|'unavailable'; message? }> }` |
| `getBodies` | `{ ids: string[] }` | `{ bodies: Array<{ id; raw?: string; truncated?: boolean; error? }> }` |
| `quoteToSideChat` | `{ contextKey; label; text }` | `'ok' \| 'unavailable'` |

客户端解析 `raw` → entries（本地，不额外往返）。`getBodies` 让详情页只在需要时取正文载荷。

---

## 5. 测试计划（旧壳完全没有的部分）

| 类别 | 内容 |
|---|---|
| RSS/Atom 解析 | 真源 fixture（RSS 2.0 + Atom，含 `<content:encoded>`、CDATA、实体、坏 XML） |
| **正文抽取** | 中英各一份**真实页面** fixture：断言抽出的段落数/字符数在合理区间，且**不把页面容器当正文**（旧抽取器在这里翻车）；断言 `nav/footer/script` 被剥离 |
| **语言感知** | 同一阈值在中英两份 fixture 上分别成立（这条正是本轮实测发现的问题） |
| 截断路径 | `truncated: true` 时抽取被拒 + 详情页出 D6 提示块 |
| 定时数学 | `timeOfDay` 下一次出现、跨日/跨月、启动补刷判定（纯函数） |
| store | `defineStore().create()` → actions/snapshot；筛选、选中、刷新计数 |
| 引用格式化 | `formatReaderRef` + `mergedQuoteDraft` 合并语义（空草稿 / 非空草稿） |
| definition | id/kind/guide 字段，页面型 tab 不含 `patterns` |
| **卡片渲染** | 挂载后断言来源名与标题**真的在 DOM 里** —— 这条就是能挡住旧壳 `return null` 的闸 |
| **点卡片语义** | 卡片主体触发打开原文；「查看更多」进入详情；未读点数恰好减一 |
| **划选引用** | 选区 → 引用块含出处；空白选区被拒；跨元素选区不抛错 |
| **boot 集成** | 真 cordis Context + 假 remote/locale/slots/sidebarRightTabs → 断言类型进了 registry、body key 进了 `ctx.slots.entries('sidebar.right.pane.tab')`，并能干净 dispose |
| 宿主服务 | 对 stub `ctx.web` / stub `ctx.fs` 做 fetch→persist→read 往返；截断拒绝；无 fs 内存降级 |

---

## 6. 交付计划与写入范围

**worktree-only**（`docs/development.md:28`）：功能代码只写在 `.worktrees/reader`。
Lead 是包内唯一写者；队友做对抗式复审。`packages/dsh-reader/**` 内不得并发写。

| 步骤 | 范围 | 依赖 |
|---|---|---|
| S0 | 打开路径探针（D12 的 `<a target="_blank">` 行为，3080 上验证） | — |
| S1 | `src/types.ts`、`src/parse-rss.ts`、`src/extract-article.ts` + 解析/抽取测试 | S0 |
| S2 | `src/store.ts`、`src/service.ts`、`src/schedule.ts` + 测试 | S1 |
| S3 | `src/remote.ts`、`src/index.ts`、`src/invariant.ts` | S2 |
| S4 | `src/client/**`（store、卡片流、详情、definition、entry） | S1, S3 |
| S5 | `tests/*.client.spec.ts`（卡片渲染 / 点卡片语义 / 划选引用 / boot 集成） | S4 |
| S6 | README 双语 + `dsh.compat` + Agent Note + `pnpm map:packages` 重生成 | S5 |
| S7 | 队友对抗式复审（对着本设计逐条查） | S6 |
| S8 | worktree 内 `pnpm gate` 全绿 → 合并 main → `pnpm deploy:3080 --package packages/dsh-reader`（含摘掉旧 `dsh-rss-reader` 行）→ 浏览器验收 | S7 |

验收门：3080 上真实订阅一个源、刷新、卡片点开原文、粘贴一条链接并**立刻**可读、划选一段引用进会话、
复制链接，全链路通过。

---

## 7. 已知限制（进 README，不藏）

1. **宿主上限**：单次抓取正文 >100,000 字符会被截断 → 这类站点抽不到全文，详情页给 D6 提示。
   实测受影响：Anthropic 研究页、theverge.com、newyorker.com。
2. **未读不落盘**：重启后未读状态重置。
3. **正文不落盘**：重启后离线不能再读已读文章（需重新联网抓取）。
4. **不支持条件 GET**：宿主抓取 seam 不接受自定义请求头、不暴露响应头，所以没有 ETag /
   If-Modified-Since，每日刷新是整份重取。
5. **无登录态**：抓不到需要登录的文章，走"打开原文"。
