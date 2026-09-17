# Agent Note: reader 重写——丢弃旧 RSS 包体，定案点击语义，宿主半 + 浏览器半交付

Status: implemented

## Problem

`@khorsheed/dsh-rss-reader@0.1.0` 发出去之后，它的右侧栏 tab 点开没有内容。原因是结构性的，不是渲染故障：`src/client/RssView.tsx` 在每条路径上都返回 `null`，所以 tab 类型注册成功、面板座位打开，然后什么都没有。同一个包还探测了一个宿主里根本不存在的 `ctx.get('fetch')` 服务，带了一个伪造的文件系统镜像，两个 verb 直接返回字面量 `'Not implemented in this build stage'`，四处 `catch {}` 静默吞掉失败，而测试只覆盖三个字符串助手——没有一条测试碰过面板、服务或启动路径，这正是缺陷能进生产的原因。

阅读器是长期存在的表面：订阅会累积、payload 会长大、这个 tab 每天都会被打开。留着一个每一处缝都是猜的壳，意味着要在用户的数据之上重新推导抓取、持久化、解析和刷新这四件事。决定是丢弃包体、重建这个能力，只保留包名与挂载点作为用户可见的身份。

## Decision

这个能力现在以 **`@khorsheed/dsh-reader`**（v0.1.0）交付，一个包、宿主半与浏览器半，范围从"只做 RSS"扩到"订阅源阅读器 + 一个存文章链接的地方"。

**宿主半**（`src/index.ts`、`service.ts`、`store.ts`、`schedule.ts`、`remote.ts`、`invariant.ts`）：`apply(ctx, config)` 构造 `ReaderService`、`ctx.provide('reader', …)`，再挂上薄薄一层 `ReaderRemoteService`（namespace `reader`，verb：`capabilities` / `listSources` / `addSource` / `updateSource` / `removeSource` / `refresh` / `getBodies` / `quoteToSideChat`）。

- **出网走 `ctx.web.fetch`**，这是官方缝（宿主里没有名为 `fetch` 的服务可供探测）。这条缝把解码后的正文截到 100,000 字符且**静默截断**；它拒绝跨源重定向（`WEB_REDIRECT_BLOCKED`），所以本服务自己最多跟 3 跳，每跳重新进缝。
- **持久化用 `node:fs`，刻意不走 `ctx.fs`**（验收时修正）。`ctx.fs` 是**沙箱**文件系统：每一次写都由**调用会话**的文件策略把关，workspace-write 会话写 `$DSH_HOME/state` 会被 `FS_SANDBOX_DENIED` 拒掉 —— 验收实例上就是这样让一次订阅失败的。这道栅栏是对的；错的是把「属于部署」的状态交给「属于会话」的能力。所以 store 用原子写（临时文件 + rename），和本仓库其它宿主态包一致（`packages/lab/src/state.ts`）。状态在 `$DSH_HOME/state/dsh-reader/state.json`（可用 `config.stateRoot` 覆盖），文件不存在读成空、损坏时拒绝而不是覆盖，目录不可写则降级为仅内存并让 `capabilities().hasFs === false`。
- **刷新是插件自有的 `setTimeout`**（`schedule.ts` 做本地日历运算）。宿主没有 scheduler 服务，也没有 `ctx.on('dispose')`；`ctx.effect` 负责拆卸。错过的窗口在启动时补刷一次，而不是丢掉。
- **payload 淘汰是"最新优先"**：`boundPayloads` 按新到旧遍历，超出单源（256 KiB）与总量（2 MiB）预算时丢最旧的正文、保留每一条源记录。第一版实现是从最旧开始遍历，结果留下上个月的正文、把刚抓到的挤掉——和设计正好相反。

**浏览器半**（`src/client/`）：一个页面型侧栏 tab（自铸 kind `reader`，tab id `@khorsheed/dsh-reader`），按官方两阶段注册——`ctx.sidebarRightTabs.register(definition)` 注册类型，`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({name, key, locale, store, inject}, ReaderPane))` 注册面板体——两者都挂在 `ctx.effect` 上。

- **解析放在浏览器，因为宿主没有解析器**：那边 `globalThis.DOMParser === false`，所以 `parse-rss.ts`（按 `localName` 处理 RSS 2.0 / Atom、真正识别 `parsererror` 拒绝、处理 CDATA 与实体解码）和 `extract-article.ts`（readability 式块评分，语言相关的最小长度——拉丁 40 字、CJK 18 字——加白名单归一化）都在客户端。
- **被截断的 payload 是抢救，不是丢弃** —— 这是本包最严重的缺陷，在验收实例上暴露并当场修掉。出网缝按字符数截断，截在标签中间会让整份文档变成坏 XML，而解析器把它报成"没东西可展示"：一条 646 KB 的 feed 到手 100,000 字符，**产出 0 条**。现在会（a）把每个完整闭合的 `<item>`/`<entry>` 片段用**文档根上的命名空间声明**重新包装后再解析 —— 没有这些声明，带 `content:encoded` 的片段自己也是坏 XML，这正是"一条完整的 42 KB 条目也一起丢掉"的原因；（b）对被截断的那块做尽力修复；（c）修复仍无法产出 XML 时，直接从标记里读出片段自己的 title/link/date/description。被截断的条目标为 `partial`，已到达的正文照常渲染，墙上说明原因并给原文链接。同一份 payload 今天产出 **2 张卡**。
- **墙是内容优先，订阅源是筛选弹层**（评审后纠偏两次）：条目卡片占第一屏；一个工具条按钮装下所有收窄方式 —— 阅读状态，以及从竖向列表里选一个源，两者都是同一个本地查询（`#<sourceId>`），搜索框也会显示并清掉它。上一版把来源卡片网格放在最前，用最宝贵的空间回答了最少被问的问题（管理）；再上一版用横排筛选片，在常常很窄的侧栏里会折行并挤压搜索框，而且源一多就铺开。
- **来源名用 feed 自己声明的标题**：宿主不能解析 feed，所以新增时只能生成 URL 派生的名字；浏览器半解析出 `<channel><title>` 后替换显示名，解析失败则回退成 URL。
- **出网缝的上限可以不碰宿主代码就抬高**（已用 `dsh --profile web --patch <file> --dump-config` 确认）：include 插件的 patch 条目支持 `config`，所以一条 `id: web-fetch-http` 的叠加行就能把 `{ maxBodyChars: … }` 合进那个已存在的宿主行 —— 走 `--patch <file>` 或机器级的 `$DSH_HOME/cordis.patch.yml`。插件**不能**做的是挂载或修改别人的行（仓库的独立性规则），所以这仍属于部署配置决策，而且它抬高的是全机所有网页抓取的上限。
- **上限无法由插件从内部抬高**：`ctx.web.fetch` 只接受 `{ url }` —— 没有 Range、没有自定义请求头、没有分页 —— 所以超过缝的 `maxBodyChars`（100,000）的 payload 永远只能读到一部分，而 vendor `fetch` 绕过去等于绕开宿主的出网策略。完整读一条 646 KB 的 feed 需要部署侧覆盖那一行宿主配置，那是组合层的改动，不是插件的 patch。
- **对读者来说这个面叫「灵感空间」**（包名、tab kind、Remote namespace 都还是 `reader` —— 稳定标识；只有文案动了）。墙上按成员 tab 的卡片习惯做来源卡片网格，末尾是虚线新增卡片；空态就是那张虚线卡片本身、单独一张。
- **新增是弹窗，不是页面**：成员 tab 邀请弹窗那套（透明遮罩 + 居中卡片，Esc / 点遮罩关闭），表头、空态卡片、墙尾虚线卡片三处都能打开。瞬时动作不该把它被唤起的墙替换掉。
- **订阅管理页接管所有关于「源」的事**：单源条目数、上次抓取、暂停/恢复、删除、单源刷新，以及每日刷新时间。「为什么我什么都没看到」和「别再刷这个了」都是关于源的问题，所以它们从墙上搬走了。
- **默认过滤是「全部」，而且过滤是可见的**：源的最新条目经常不是今天的（实测：验收实例那条 feed 最新一篇 8 天前），默认「今日」会把一次成功的订阅渲染成空墙。今日/全部的分段控件把「被隐藏了什么」显式化；刷新按钮在请求期间会转，落地后重新读墙 —— 之前那版只替换了宿主里的 payload、从不重读，所以按钮看起来是死的。
- **列表会说明这份快照有多旧**：卡片下方一行新鲜度（「刷出于 3 小时前 · 每日 10:00」），来自 `capabilities().lastRefreshAt` / `nextRefreshAt`，让读者自己决定要不要为一次刷新付一轮网络 —— 刷新确实会重新抓取每一条启用的源。
- **面板要么渲染出内容，要么说明为什么渲染不出**：列表一卡一条，未读是来源瓷砖角上一个 7px **圆点**（会话级、不落盘，用浮层定位，所以读/未读不会让标题位移）；工具条的搜索 / 只看未读 / 排序都是本地谓词（D14）；详情页把归一化后的正文当 DOM 文本渲染——这正是 `@khorsheed/dsh-quote` 那个帧级选区菜单能覆盖它的原因，所以本包不自己造选区菜单；被截断的正文以一行「受限篇幅，内容未完整呈现」加一个「阅读原文」按钮收尾。
- **没有任何东西按 preset 自隐**：安装层就是这个 tab 的模式可见性，所以这里不涉及 `pluginInventory` 探测。
- **粘贴进来的 URL 是什么，由抓回来的内容决定**（D15）：feed 就变成订阅，网页就存成一条，都不靠 URL 形状去猜。

**点击语义是方案 B**：点卡片进详情页；浏览器是详情页里的一个动作（工具条按钮，外加正文不完整时那个按钮）。卡片尾部的箭头是提示，不是控件。这一条是与用户确认后定案的，不是推断的。

**降级按手势发生，永不按启动发生**：没有 `web` → `unsupported-content` / `fetch-failed`；没有 `sideChat` → 侧边对话动作隐藏；没有 `quote` → 选区浮层自然缺席，而条目级「引用」按钮照常工作；`addSource` 返回领域拒绝值，从不抛异常。

## Testing

六个套件共 95 条测试，其中三条是专为本包已经发生过的事故写的：

- `tests/boot.spec.ts` 在一个**真实的 Cordis `Context`** 上启动宿主半，断言 `ctx.get('reader')` 存在、Remote 面以自己的服务键挂载且真的在转发、以及一个没有 `fs`/`web`/`sideChat`/`quote` 的组合照样能启动。旧壳什么都没提供；这条断言在它身上必然失败。
- `tests/boot.spec.ts` 还承载**会话栅栏文件系统的回归**：它挂上一个每个方法都抛 `FS_SANDBOX_DENIED` 的 `ctx.fs`，断言插件照样返回领域值（且从未碰过那个服务），并断言在一台宿主上添加的源能被同一个状态根上的第二台宿主看见。这个 bug 是在验收实例上暴露的；这里就是它被永久钉住的地方。
- `tests/ReaderPane.client.spec.tsx` 在 jsdom 里用真实 store 实例和脚本化的宿主 payload 渲染面板，断言的是"内容真的到了 DOM 里"（空态、卡片、打开的正文），而不是"某个函数返回了东西"。
- `host-pure.spec.ts` 覆盖刷新时钟、payload 分类器、URL 策略、状态归一化与淘汰边界；`parse-rss.spec.ts` 与 `extract-article.spec.ts` 跑在真实抓取的页面样本上；`selectors.spec.ts` 锁住过滤/搜索/排序谓词。

渲染套件立刻证明了自己的价值：它抓出了它所服务的实现里的两个真缺陷——默认「今日」过滤会把每一条保存的文章链接都滤掉（链接条目没有 `publishedAt`，而 `isToday(undefined)` 是 `false`，于是最主要的"粘贴链接"流程产出的是一条永远看不见的链接），以及抓取上限的 `truncated` 标记在 wire 信封到解析条目之间被丢掉了，导致那行「内容未完整呈现」在它专为的那个场景里永远渲染不出来。两处都已修好并被测试锁住。

## Alternatives considered

**留着旧包打补丁。** 否掉：tab 没内容是因为组件返回 `null`，而它背后抓取缝、文件系统镜像、刷新故事全都是编的。没有一条可用的路径可供修补——每处缝都要重新推导，所以丢掉包体、保留包名与挂载点（用户可见的身份）。已发布的 `@khorsheed/dsh-rss-reader@0.1.0` 走弃用，而不是复用。

**把文章渲染进沙箱 iframe 或 browser pane。** 否掉：iframe 里的文字不能作为引用源（可引用文本需要是应用级 DOM），而 `proposals/active/2026-09-13-browser-pane.md` 还是 `planned`，canvas 的 CDP 帧同样承载不了划选引用。渲染归一化标记才是同时买到可读性和可引用性的做法。

**对宿主缝截断的文章直接 vendor `globalThis.fetch`。** 否掉：那是在绕开宿主的出网策略，而这条缝的存在就是为了强制执行它。上限被记录为已知限制，并在 UI 上呈现。

**订阅刷新时预抓每个条目的正文。** 否掉：存储会爆，而且那是在当爬虫。正文在条目被打开时才抓。

**宿主侧 scheduler 或条件 GET 方案。** 今天不存在：没有 scheduler 服务，缝也不暴露自定义请求头入口，所以插件自己持有 `setTimeout`，每次刷新都是完整抓取。

**持久化已读游标与正文。** 目前否掉：那需要第二份写密集文档，而对应的价值只是"自上次看过以来有什么新的"。已读状态与正文都是会话状态。

## Consequences

- 重写后的包可独立安装与卸载；卸载后只剩一个文件（`$DSH_HOME/state/dsh-reader/state.json`），README 明确告诉读者想彻底清干净就删掉它。
- `dsh.compat.minHost` 钉在 `0.1.5-rc.1`——该线侧栏座位、`ctx.web.fetch`、`ctx.fs` 全在——并把 100,000 字符静默截断记进 `dsh.compat.notes` 和两份 README。
- 对大页面而言文章这一半确实弱于 feed 那一半（实测：Anthropic 研究页约 266k 字符、theverge.com 约 899k、newyorker.com 约 1.97M，对 100k 上限；RSS 源实测 11 KB–83 KB），所以正文不完整那一行提示和"去原文"按钮是承重 UI，不是打磨。
- 在正文里划选由 QUOTE 插件自己的浮层负责引用；本包只贡献条目级的「引用」/「侧边对话」按钮，这让两个包保持独立。
- 渲染测试套件是旧包那次事故的长期答案：当面板不再往 DOM 里放内容时它就会失败，而这恰恰是助手级单元测试在结构上看不见的唯一失效模式。
