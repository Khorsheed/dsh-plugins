# Agent Note: reader 重写——丢弃旧 RSS 包体，定案点击语义，宿主半 + 浏览器半交付

Status: implemented

## Problem

`@khorsheed/dsh-rss-reader@0.1.0` 发出去之后，它的右侧栏 tab 点开没有内容。原因是结构性的，不是渲染故障：`src/client/RssView.tsx` 在每条路径上都返回 `null`，所以 tab 类型注册成功、面板座位打开，然后什么都没有。同一个包还探测了一个宿主里根本不存在的 `ctx.get('fetch')` 服务，带了一个伪造的文件系统镜像，两个 verb 直接返回字面量 `'Not implemented in this build stage'`，四处 `catch {}` 静默吞掉失败，而测试只覆盖三个字符串助手——没有一条测试碰过面板、服务或启动路径，这正是缺陷能进生产的原因。

阅读器是长期存在的表面：订阅会累积、payload 会长大、这个 tab 每天都会被打开。留着一个每一处缝都是猜的壳，意味着要在用户的数据之上重新推导抓取、持久化、解析和刷新这四件事。决定是丢弃包体、重建这个能力，只保留包名与挂载点作为用户可见的身份。

## Decision

这个能力现在以 **`@khorsheed/dsh-reader`**（v0.1.0）交付，一个包、宿主半与浏览器半，范围从"只做 RSS"扩到"订阅源阅读器 + 一个存文章链接的地方"。

**宿主半**（`src/index.ts`、`service.ts`、`store.ts`、`schedule.ts`、`remote.ts`、`invariant.ts`）：`apply(ctx, config)` 构造 `ReaderService`、`ctx.provide('reader', …)`，再挂上薄薄一层 `ReaderRemoteService`（namespace `reader`，verb：`capabilities` / `listSources` / `addSource` / `updateSource` / `removeSource` / `refresh` / `getBodies` / `quoteToSideChat`）。

- **出网走 `ctx.web.fetch`**，这是官方缝（宿主里没有名为 `fetch` 的服务可供探测）。这条缝把解码后的正文截到 100,000 字符且**静默截断**；它拒绝跨源重定向（`WEB_REDIRECT_BLOCKED`），所以本服务自己最多跟 3 跳，每跳重新进缝。
- **持久化走 `ctx.fs`**，通过**延迟**的 `ctx.inject(['fs'], …)` 拿到，而不是 apply 时探测，这样晚挂载的文件系统仍会被接上；状态在 `$DSH_HOME/state/dsh-reader/state.json`（可用 `config.stateRoot` 覆盖），读容忍文件不存在、拒绝文件损坏，写是读-改-写并带一次 `FS_STALE_VERSION` 重试。**没有 `fs` 时文档只在内存里**，`capabilities()` 报 `hasFs: false`，不假装有持久化。
- **刷新是插件自有的 `setTimeout`**（`schedule.ts` 做本地日历运算）。宿主没有 scheduler 服务，也没有 `ctx.on('dispose')`；`ctx.effect` 负责拆卸。错过的窗口在启动时补刷一次，而不是丢掉。
- **payload 淘汰是"最新优先"**：`boundPayloads` 按新到旧遍历，超出单源（256 KiB）与总量（2 MiB）预算时丢最旧的正文、保留每一条源记录。第一版实现是从最旧开始遍历，结果留下上个月的正文、把刚抓到的挤掉——和设计正好相反。

**浏览器半**（`src/client/`）：一个页面型侧栏 tab（自铸 kind `reader`，tab id `@khorsheed/dsh-reader`），按官方两阶段注册——`ctx.sidebarRightTabs.register(definition)` 注册类型，`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({name, key, locale, store, inject}, ReaderPane))` 注册面板体——两者都挂在 `ctx.effect` 上。

- **解析放在浏览器，因为宿主没有解析器**：那边 `globalThis.DOMParser === false`，所以 `parse-rss.ts`（按 `localName` 处理 RSS 2.0 / Atom、真正识别 `parsererror` 拒绝、处理 CDATA 与实体解码）和 `extract-article.ts`（readability 式块评分，语言相关的最小长度——拉丁 40 字、CJK 18 字——加白名单归一化）都在客户端。
- **面板要么渲染出内容，要么说明为什么渲染不出**：列表一卡一条，未读是来源瓷砖角上一个 7px **圆点**（会话级、不落盘，用浮层定位，所以读/未读不会让标题位移）；工具条的搜索 / 只看未读 / 排序都是本地谓词（D14）；详情页把归一化后的正文当 DOM 文本渲染——这正是 `@khorsheed/dsh-quote` 那个帧级选区菜单能覆盖它的原因，所以本包不自己造选区菜单；被截断的正文以一行「受限篇幅，内容未完整呈现」加一个「阅读原文」按钮收尾。
- **没有任何东西按 preset 自隐**：安装层就是这个 tab 的模式可见性，所以这里不涉及 `pluginInventory` 探测。
- **粘贴进来的 URL 是什么，由抓回来的内容决定**（D15）：feed 就变成订阅，网页就存成一条，都不靠 URL 形状去猜。

**点击语义是方案 B**：点卡片进详情页；浏览器是详情页里的一个动作（工具条按钮，外加正文不完整时那个按钮）。卡片尾部的箭头是提示，不是控件。这一条是与用户确认后定案的，不是推断的。

**降级按手势发生，永不按启动发生**：没有 `web` → `unsupported-content` / `fetch-failed`；没有 `sideChat` → 侧边对话动作隐藏；没有 `quote` → 选区浮层自然缺席，而条目级「引用」按钮照常工作；`addSource` 返回领域拒绝值，从不抛异常。

## Testing

五个套件共 81 条测试，其中两条是专为旧包那次事故写的：

- `tests/boot.spec.ts` 在一个**真实的 Cordis `Context`** 上启动宿主半，断言 `ctx.get('reader')` 存在、Remote 面以自己的服务键挂载且真的在转发、以及一个没有 `fs`/`web`/`sideChat`/`quote` 的组合照样能启动。旧壳什么都没提供；这条断言在它身上必然失败。
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
