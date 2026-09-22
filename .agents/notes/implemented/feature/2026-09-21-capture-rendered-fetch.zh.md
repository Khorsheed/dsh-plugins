# Agent Note：capture —— 渲染抓取宿主服务（阅读器摄入 M1）

Status: implemented

## Problem

阅读器的主场景是多图科技博客与论文，而整一类页面抓回来是空壳：transformer-circuits.pub 的 102 个 `<figure>` 全由 d3 bundle 现场渲染（约 20 个只靠 IntersectionObserver——快速扫过根本不触发），官方出网缝 `ctx.web.fetch` 取回的标记里文章本体位置全是洞。[摄入提案](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md)已定案（D1）：修法是独立包而非阅读器内脏——百 MB 级浏览器二进制与 SSRF/安全面值得自己的边界，未来其他消费方（canvas、datasets）骑同一个动词。阅读器 M0 已把集成槽位铺好：「渲染抓取」手势只在 `capture` Remote 探测在场时渲染（`ctx.get('remote.capture')?.render`，结构化、永不 import）。M1 就是让这处探测有应答的包。

## Decision

`@khorsheed/dsh-capture`（`packages/capture`）：宿主半渲染抓取服务。一个 Remote 命名空间 `capture`，一个动词 `render({url, timeoutMs?}) → { html, finalUrl?, title?, truncated? }`——与阅读器在 `packages/dsh-reader/src/client/contract.ts:56-64` 结构镜像的形状逐项一致；拒绝是抛出带 `capture/*` 码的 `RemoteError`（`invalid-url`、`private-target`、`unavailable`、`navigation-failed`、`timeout`、`busy`），成功值里绝不夹第二个 `{ ok }` 联合。

- **进程模型**，复用已关闭的 [browser-pane](../closed/2026-09-13-browser-pane.md) 评审沉淀：一个受管 Chrome 进程（`pipe: true` 走 stdio——不监听任何 TCP 端口），每次渲染一个全新临时 `BrowserContext`（零 Cookie/凭据残留），空闲 60s 退出，崩溃后下次渲染自动重启。Chrome for Testing 二进制住在 `$DSH_HOME/state/dsh-capture/`，**首次渲染时才**下载；装/拉失败是该次调用的 `capture/unavailable`，绝不是启动崩溃。`executablePath`/`channel` 配置可覆盖。capture 不交付那个提案的帧串流、IME、模型工具——capture 只是一个请求-响应动词。
- **SSRF 闸**（`src/url-policy.ts`，纯）：只放 http(s)；带凭据 URL 拒绝（地址栏里的登录态也是登录态）；主机名逐个解析、**每个**答案必须公网——回环/私网/CGNAT/链路本地（含元数据 169.254.169.254）/组播/保留段全拒，IPv4 映射/NAT64/6to4 按内嵌 IPv4 分类，异形 IPv4 拼法经 WHATWG 解析器归一化后到达；`localhost` 按名拒绝。请求拦截让**每一跳重定向**重新过整道闸（公网 URL 302 进私网就是它要堵的逃逸）；子资源只放 http(s)/data/blob。
- **渲染管线**（`src/service.ts` + `src/page-tasks.ts`）：导航（`load`，默认 30s，调用方 `timeoutMs` 钳 1–120s）→ HTTP ≥400 拒绝 → 落地地址兜底重查 → 网络静默（500ms 无在途，5s 封顶）→ 全页滚动遍扫、每 0.8 视口停留 500ms（实测的 IntersectionObserver 需求）20s 预算 → 页内内联+序列化。
- **样式内联是产品本身，不是打磨**：命中的 CSSOM 规则按（`!important` → 内联性 → 选择器权重 → 文档序）定胜负写进 `style`，`var()` 沿自定义属性级联解析（回退、嵌套、环保护）；SVG 呈现属性**同时写成属性**——下游白名单只留属性不留 `style` 时颜色照样在。对真实目标站的实弹验证又照出两个解析面：页面脚本直接写成**属性**的 `var()`（`fill="var(--brand)"`，没有规则命中它）与原始内联 style 文本里的 `var()`（浏览器把 `background: var(--x)` 拆成枚举为空值的待替换长属性——只有属性文本还带着这条声明）都在任何 CSSOM 改写之前按文本解析；脚本运行时设置的或跨源样式表定义的自定义属性（应用但拒绝 CSSOM 读取）由 `getComputedStyle` 兜底。然后剥掉脚本、样式块与样式表 link，输出截断在约 8M 字符并置 `truncated`。页内函数按构造自包含（被字符串化送进页面），在 jsdom 测试里原样运行。
- **权限是手势门（v1）**：阅读器只在用户显式点击时调 `render`——那次点击就是批准；某主机首次**成功**渲染后把逐站点 allow 记录写进 `state.json`（`node:fs` 原子写，不走 `ctx.fs`；损坏读成空、永不覆盖），供未来非交互调用方按「以前批准过」设闸。危险目标无论记录如何永远拒绝。
- **浏览器半只做挂载，且必须存在**：`remote.capture` 只在有人 `$mount` 生成的 contribution 后才在客户端实体化，而客户端 bundle 纯性闸禁止阅读器 import `@khorsheed/dsh-capture/remote`——所以本包的薄客户端半（`src/client/index.ts`，`dsh.client.immediately`）只做挂载。没有设置 UI——那是推迟，不是疏漏。
- **puppeteer 面经结构化接口消费**（`src/browser.ts`），驱动本体走变量说明符的动态 import：typert 生成器对着 harness 检出分析源码，那里没有 puppeteer，静态 import 会让面生成失败（且会在启动时加载驱动）。

## Alternatives considered

**完全没有客户端半**（提案草稿的「宿主半一个包，无客户端半（或极薄）」）。那没有任何一方挂载 contribution，`ctx.get('remote.capture')` 永远不应答——阅读器 M0 的探针永远是死代码。只做挂载的半边是让 Remote 可达的最小形态；它不携带 UI。
**已关闭 browser-pane 的完整许可门**（站点 allow/block 表 + 首访批准弹窗，加模型工具）。推迟：v1 唯一调用方已是手势门，点击即批准，弹窗等于批准一个批准。逐站点记录今天就在写，正是为了那道门日后落地不用重推历史；非交互调用方（提案里 openreview 取标题）才是建它的触发点。
**把 figure 栅格化成 PNG 截图**（提案的保真兜底）。失去 SVG 文字的可引用性——而引用是阅读器的全部意义；内联路线实测对静态图足够（其余全是 DOM/SVG）。更新（2026-09-22）：验收随后显示 JS 驱动的子集（canvas/监听器部件——同一目标 102 张里的 23 张）残破到内联无法承载，栅格化落地且严格限定在该子集——见[capture——JS 驱动部件图的像素快照](2026-09-22-capture-widget-snapshots.md)。
**逐元素 `getComputedStyle` 快照。** 级联最真，但每元素吐出几百条属性——为同样的图颜色付出数 MB 噪音；命中规则内联只写文档真实声明的东西。
**阅读器自己 import `@khorsheed/dsh-capture/remote` 来挂载。** 纯性闸按构造禁止跨包值 import，而且这会把阅读器的构建耦合到 capture 的在场——结构镜像契约（`ReaderCaptureRemote`）存在的原因就是两边各自独立发版。
**用完整 `puppeteer` 而不是 `puppeteer-core` + `@puppeteer/browsers`。** 它的 postinstall 在 npm install 时把 Chrome 下载进共享缓存——与懒加载、住状态目录、可覆盖全相反。

## Consequences

- JS 重页面成为普通阅读器 entry：捕获产物过**同一道**白名单提取器，引用、句级翻译记忆、阅读位置记忆零适配覆盖（M0 的流程本就完整；这个包就是 M1 的全部增量）。
- 一次渲染以秒计（停留 × 步数），一个 Chrome 活着时占几百 MB；队列把它压在一个进程，空闲超时归还内存。调用方必须把 render 当慢手势，绝不当批量抓取——有界的等待线用 `capture/busy` 拒绝爬虫式的野心。
- 保真边界（交互冻结、headless ≠ 逐像素、跨源样式表读不到、级联近似、遍扫预算）是用户可见的诚实，写在 README 里，不只在代码注释里。
- 未来消费方（D3 的 openreview 取标题、canvas/datasets）调同一个动词；`capture/*` 错误词汇表是他们签约的稳定部分。

## Testing

`packages/capture`——66 个测试，本地全绿：

- `tests/url-policy.spec.ts`：纯拒绝矩阵（scheme、凭据、整表 IP 分类——含映射/NAT64/6to4 与解析器归一化的异形、桩 DNS 的各结局、按名拒绝 localhost）。
- `tests/page-tasks.spec.ts`（jsdom）：CSS 变量内联到 SVG（style + 呈现属性双写）、继承与嵌套 `var()` 链、回退、权重/序/important 级联、最右复合预筛、脚本/样式剥除、尺寸上限、遍扫的步进/停留/预算（脚本化的可滚动页面）。
- `tests/queue.spec.ts` / `tests/store.spec.ts`：串行、顺序、失败收容、忙线；空/损坏/原子持久化、原型键守卫、500 条 LRU 上限。
- `tests/boot.spec.ts`：真实 Context 启动（服务与 Remote 面都应答）、经两张面的拒绝矩阵、unavailable/timeout/HTTP 状态映射、中飞重定向拒绝、队列忙、dispose——经 launch/install 缝用假受管浏览器。
- `tests/render.integration.spec.ts`：本地 fixture 服务器供一个 IntersectionObserver 懒渲染、CSS 变量着色的 SVG 页面，用**真实 Chrome** 驱动（回环 fixture 经 `--host-resolver-rules` + resolver 缝到达，因为政策按设计拒绝回环）：懒图带着解析后的颜色到达、重定向报 `finalUrl`、逃逸回环的重定向中飞被拒、404 带状态映射。**没有 Chrome 二进制时整体跳过**（CI 就没有；解析顺序：`DSH_CAPTURE_CHROME_PATH`、默认状态目录下的受管安装、系统 `chrome` 渠道）。本地已对系统 Chrome 验证通过。
- 实弹打实测目标站（transformer-circuits.pub/2026/workspace，系统 Chrome，构建产物）：102 个 figure 全在，63 个带内联 SVG（带图注的 Figure 1/2 图表在其中；其余是该站的 Google-Docs 图片 figure，带真 `<img>`），5638 个解析后的 fill 属性，**零 `var()` 残留**，零 script/style 标签，5.1 MB 未触发截断。两个属性承载的 `var()` 面（呈现属性、带 var 的内联 shorthand）就是这次跑出来后修的——只走 CSSOM 的版本残留了 87 处。
