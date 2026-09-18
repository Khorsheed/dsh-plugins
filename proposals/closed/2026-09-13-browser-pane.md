# 右栏内嵌浏览器（browser-pane）

- **分类**：plugin
- **状态**：closed（放弃）
- **最后更新**：2026-09-18
- **关闭记录（2026-09-18）**：官方 0.1.6-alpha.2 交付 Sidebar Browser（`@deepseek-ai/dsh-client-ui-sidebar-browser`，随 web-app bundle 默认挂载）：右栏 iframe 沙箱浏览器 + chat 正文链接接管 + `openTab('browser')` 公共打开缝。用户拍板：**用官方 browser，自研 CDP 帧串流路线不做**。闭卷留档——两轮评审沉淀的 WS 帧协议 / 背压 / IME / 许可门设计仍有参考价值；「人机同视图 + 模型工具操作同一 context」是本提案独占、官方明确不做（其 README 自述 Model Experience: None）的差异场景，需求复燃可重开（M0 探针阈值表直接可用；注意官方已占用 `browser` kind 名，tab-registry 默认 extension 优先级会接管官方实现，重开时此为第一决策点）。
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 `proposed/`、`implemented/`、`rejected/`），关键词「浏览器 / browser / webview / CDP / iframe / screencast / 内嵌 / 框架」——**无重复提案**。命中四处**相关**而非重复：
  - [local-files-browser](../closed/2026-08-26-local-files-browser.md)（done，`@khorsheed/dsh-local-files`）：**右栏 tab 注册与视图骨架的实现先例**，本提案照抄其惯例。注意它是「文件浏览器」，与「网页浏览器」无关，只是词面撞车。
  - [file-view-html-rendering](2026-08-21-file-view-html-rendering.md)（in-progress）：`ui-file-preview` 的**沙箱 iframe + postMessage 能力桥**是"渲染不受信内容"的先例。本提案**不走 iframe**（见风险⑥），但复用它「内容是不可信的」这条边界约定。
  - [mobile-access](2026-08-19-mobile-access.md)：Web GUI 跨网络承载时的**路由注册 + 会话级凭据**先例。
  - [inspiration-canvas](2026-09-13-inspiration-canvas.md)（planned）：同期立项的另一个右栏 tab 插件，tab 契约与验收写法的参照。
- **官方依赖**：纯插件。只用官方公开面：右栏 tab 契约、`ctx.webServer.register` / `registerUpgrade`、`ctx.tools.register`。第三方运行时依赖（`puppeteer-core` + Chrome for Testing）是 npm 依赖，不是官方包改动。**一处需要留意**：`registerUpgrade` 在已发布的社区包里**尚无消费者**（见现状②），本提案是第一个，属"公开面但未经验证"的用法。

## 目标

在右栏里**看并且操作外部网站**，且**和模型共享同一个视图**——模型点的那一下，人看得见；人改的那个输入，模型读得到。

三件事：

1. **一个真的浏览器，不是 iframe**：能打开需要 JS、需要登录的普通外部站点。
2. **人机同视图**：面板是这块浏览器的显示器 + 输入设备，不是另开一个窗口。
3. **给模型的手**：`browser_*` 工具在同一会话上导航 / 点击 / 输入 / 截图 / 读渲染文本，带站点许可门。

**非目标（v1 明确不做）**：不复用用户日常 Chrome 的登录态（M4 才谈，见风险④）；不做书签 / 历史 / 扩展管理；不做多用户共享；不做抓取爬虫——这是"看一个页面"，不是"批量采数据"。

## 现状（官方契约实测）

立项前逐条实测过（首轮评审又逐条复核过），结论决定了方案的形状：

**① 右栏 tab 是白送的座位，但注册是两步。**
类型定义 `SidebarRightTabDefinition{ id, kind, patterns, canOpen, title, guide }`（宿主 `packages/client/ui-sidebar-right/src/client/tab-registry.ts:87-127`）。注册**不是**往 keyed 槽里塞一个类型就完事：先 `ctx.sidebarRightTabs.register(definition)`，再以 **`definition.id` 为键**把 body 注册进 `sidebar.right.pane.tab`（先例 `packages/ui-file-preview/src/client/index.ts:195-205`）。跨包槽位注册必须走 `slots.inject(key, () => slots.register(...))`。`guide` 条目自动成为指南页卡片；只有我们一个类型时直接进入。

**② 宿主已有 HTTP 与 WebSocket 注册面，但 WS 那半没被验证过。**
`ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler })`（HTTP，exact 优先、再最长 prefix）与 `registerUpgrade({ path, handler })`（**仅精确路径**），各返回 disposer；**重复路径抛错**（`packages/host/webserver/src/index.ts:38-55,159-185`）。无自带 TLS / 鉴权 / origin 策略（`webserver/README.md:113`）。实测三个消费者——`file-preview/src/index.ts:175-184` 的 prefix 图片路由、`whalesong/src/index.ts:80-91` 的配置路由、`ankh-guard/src/browser-handoff.ts:593-602` 的 handoff 路由——**全部是 HTTP 路由，没有一个用 `registerUpgrade`**。→ 帧流是本提案第一个 WS 消费者，M0 必须包含"WS 升级在本宿主上真的能跑"的独立探针。

**③ Web shell 不设 `frame-src`，但这对本提案无用。**
grep 全仓 `Content-Security-Policy`：只有 `session-controller` 的媒体引用（`sandbox; default-src 'none'`）与 desktop 的 `plugin-manager.html` meta。父页面不拦 iframe——但**目标站点自己会拦**（`X-Frame-Options` / `frame-ancestors`），且跨域 iframe 对父页面是黑盒，模型读不到 DOM。这是"必须走真浏览器"的**原因**，不是"顺手选真浏览器"。

**④ 宿主没有可依赖的浏览器自动化运行时能力。**
grep `puppeteer|playwright`：命中 `apps/web/tests/*.e2e.ts` 与 `packages/experimental/inspector/package.json:39-58`，**全部是 devDependency**（评审纠正了首稿"只在 apps/web"的说法，但结论不变）：已发布的运行时里没有任何可依赖的浏览器自动化能力。→ 运行时依赖要我们新增，方案里必须写清它是什么、装在哪、多沉。

**⑤ Chrome 136 起「连我平时那个 Chrome」需要非默认数据目录。**
官方公告（**外部事实，非本仓实测**）：`--remote-debugging-port` / `--remote-debugging-pipe` 对**默认数据目录**不再生效，必须配 `--user-data-dir` 指向非标准目录；自动化场景官方改推 Chrome for Testing。这条决定 M1 用 pipe 而不是端口，也决定"复用日常登录态"只能走扩展（M4）。

**⑥ Electron 那条路只对 desktop 有效，且 desktop 今天还没那么干。**
`apps/desktop` 依赖 `electron ^44`，但当前 `apps/desktop/src/main.ts:82-83` 只用 `BrowserWindow`，**`WebContentsView` 是会新增的实现，不是现状**（评审纠正了首稿）。3080 这个 Web GUI 跑在用户自己的浏览器里，只能靠帧串流。本提案只做 3080；desktop 面留 M5。

**⑦ Codex 同源做法的公开形状（外部事实）。**
in-app browser = **它自己的实例**，官方明说不支持认证流程 / 登录态页面 / 常规 profile / cookies / 扩展 / 已有标签页；登录态网站走 **Chrome 扩展**（扩展侧 `chrome.debugger` 附真实标签页）；`Browser use` 是给模型的工具层，带 allowed / blocked website；Developer mode 才开完整 CDP。→ 本提案的切分与之同构：**自托管实例打底，扩展桥后插**。

## 方案

### 0. 命名与产物

| 产物 | 包 / 目录 | 职责 |
|---|---|---|
| 宿主半 | `@khorsheed/dsh-browser` / `packages/browser` | 受管 Chrome 进程、CDP 客户端、WS 帧协议、会话与许可 |
| 客户端半 | `@khorsheed/dsh-client-ui-browser` / `packages/ui-browser` | 右栏 tab、浏览器 chrome、canvas、输入转发 |
| 扩展桥（M4，未立项） | `packages/browser-extension/`（MV3） | 附到用户真实标签页，回连宿主 |

**结构判断（后置为方向，不是 M1 工作）**：客户端半边应与浏览器来源解耦，换 provider 不动客户端。但**三种 provider 的能力并不等价**（扩展桥能附真实登录态、`managed` 不能），所以现在**不抽公共接口**——M1 写单一 managed session adapter，等第二个实现真的出现再按差异抽 capability 接口。首稿的 `BrowserProvider` 抽象是评审要求砍掉的一项。

### 1. 受管浏览器与进程模型

M1：`puppeteer-core` + Chrome for Testing，`launch({ pipe: true, executablePath, userDataDir })`——**pipe 而不是端口**：走 stdio，不监听任何 TCP 端口，也就没有"本机任何进程都能连上这个 CDP"的面（`connectOverCDP` 则需要 HTTP/WS endpoint，**连不上 pipe**，这正是 B2 手工路线必须走端口的原因）。

**进程模型（评审纠正首稿）**：**一个受管 Chrome 进程 + 每会话一个独立 `BrowserContext`**，不是"一会话一进程"（那会爆内存）。会话结束销毁其 context；最后一个会话结束才停进程。崩溃隔离留待评估。

默认 `--headless=new`；`--show-window` 作调试开关（B2 形态，见风险⑤）。M1 **不做持久 profile**（用临时 context），持久化留 M2 并需单独决定。

### 2. 帧协议（宿主 ⇄ 客户端，一条 WS）

`registerUpgrade({ path: '/browser/ws' })`：一条连接承载下行帧与上行输入。

**报文形状（评审纠正，二轮定稿）**：不用"JSON 控制帧与二进制帧混行"（两者错配是经典 bug 源）。**所有报文——控制帧与图像帧——统一走同一个二进制 envelope**，一条连接一个解析器：

```
[1B type][4B 头长 BE][JSON 头][负载]
```

- `type`：`0 = 控制帧`（无负载，头里带 `op` 与参数）、`1 = 图像帧`（负载为 JPEG，头带 `targetId / seq / width / height / ts`）；
- 头长与负载长度均为**大端 uint32**；单条报文**上限 8 MiB**，超限即断开并记错（不让畸形帧把面板打爆）；
- 不再保留"或严格 frameId 状态机"这类二选一表述——**定死一种**。

**背压（评审纠正，二轮定稿为单一背压）**：**收到 CDP 帧立刻回 `Page.screencastFrameAck`**——绝不等待客户端确认，慢网下那会把 Chrome 冻住。**协议里不设客户端 ack**（二轮评审指出：既已有覆盖队列，再加一层 ack 就是双重背压语义，宁可删掉）。限流全在宿主侧：只保留**最新一帧**的覆盖队列（旧帧直接丢并计数），发送前看 WS `bufferedAmount` 决定是否跳过本帧。`Page.startScreencast` 需显式 `maxFramesInFlight: 1`：CDP 默认允许 3 帧在途，"不回 ack 就不再出帧"是**设了 1 之后**的行为，不是默认（评审纠正首稿）。

| 方向 | 消息 | 说明 |
|---|---|---|
| ↓ | `hello { sessionId, targets, activeTargetId, viewport }` | 连接建立后的第一份状态 |
| ↓ | `frame { targetId, seq, width, height, ts }` + JPEG | 统一 envelope；CDP 给 base64，宿主解码成二进制再转发（省 33%） |
| ↓ | `state { targets, loading, title, url, canGoBack, canGoForward }` | 驱动地址栏与标签条 |
| ↑ | `input { targetId, kind: 'mouse' \| 'wheel' \| 'key' \| 'text', … }` | 见 §3 |
| ↑ | `nav { targetId, action: 'goto' \| 'back' \| 'forward' \| 'reload' \| 'stop' }` | |
| ↓ | `error { code, message }` | |

关键 CDP 事实（**外部事实**；M0 第一件验证项就是它们，出处见文末）：

- `Page.startScreencast({ format:'jpeg', quality, everyNthFrame, maxFramesInFlight })` → `Page.screencastFrame{ data, sessionId, metadata }`，`metadata` 带 `pageScaleFactor / offsetTop / deviceWidth / deviceHeight / scrollOffsetX / scrollOffsetY`；帧协议**属实验性**，升级 Chrome 需回归。
- **没有独立的滚轮命令**：就是 `Input.dispatchMouseEvent({ type: 'mouseWheel', … })`（评审纠正首稿）。
- **坐标**：`x/y` 是**主帧 viewport 的 CSS 像素**，通常**不应**再叠加页面 `scrollOffset`（首稿写错）。面板 CSS 像素 → viewport 的换算靠 `pageScaleFactor` 与 `deviceWidth/Height`；算错的表现就是"点偏了"。
- 面板尺寸变化时用 `Emulation.setDeviceMetricsOverride` 对齐 viewport，不要靠 CSS 拉伸 canvas。

### 3. 客户端半边

- 注册 `browser` tab 类型（`id` = 包名，`canOpen` 只认自己的 kind），两步注册见现状①。
- tab body **自绘整套 chrome**（目标形态：标签条 + `+` + 前进 / 后退 / 刷新 + 地址栏 + 空状态），不复用官方输入机。
- 帧画在 `<canvas>`：`ImageBitmap` + `drawImage`，按 `devicePixelRatio` 缩放；**不每帧新建 `<img>`**（会抖）。
- **中文输入是本项目最容易翻车的地方**：canvas 接不到 IME。基线方案（评审认可）：一个视觉隐藏但可获得焦点的 `<textarea>` 承接 `compositionstart / compositionend`，组合结束用 `Input.insertText` 提交（CDP 的 `insertText` 正是为"不来自按键的文本"设计的），并**用 `Input.imeSetComposition` 覆盖组合态预览**，同时处理焦点、选区与"组合中途取消"。同一机制复用给粘贴。
- 空状态照官方风格给两行（"开始浏览 / 输入 URL 以打开页面"），入口同时出现在指南页卡片。

### 4. 工具层与许可门（M2）

`browser_navigate` / `browser_targets` / `browser_screenshot` / `browser_click` / `browser_type` / `browser_read_text`，全部 `setToolOrigin({ channel: 'plugin', owner: '@khorsheed/dsh-browser' })`。

**页面文本进模型上下文之前必须过许可门**：这是 prompt injection 的正面入口，而 CDP 又跑在一个能读 cookie 的会话上。评审明确指出：**许可门不防注入**，所以还要：

- 站点 allow / block 表（首次访问要求批准），照 Codex 的 allowed / blocked 形状；
- 工具结果标注 provenance（"内容来自不可信页面"）、**限量**、与指令隔离；敏感动作**逐次确认**而非一次授权长期有效；
- **按能力构造 CDP 门面**，而不是"禁几个 cookie 命令"：`Runtime.evaluate(document.cookie / localStorage)`、网络响应体、下载都是外泄面；
- M4 的扩展桥**默认禁读真实 profile**。

### 5. 座位与并发

- v1：**右栏 tab**（与 `inspiration-canvas` / `local-files` 同一座位），支持全屏展开。
- 多标签：CDP target 列表即标签条；M1 **只做单页**（多标签留 M2，多路帧流的带宽与丢帧策略要单独设计）。
- 一个会话一个 `BrowserContext`（进程模型见 §1）。

## 与官方 MCP 客户端的关系（评审新增，二轮修正）

宿主有官方 `packages/mcp/mcp-client`，能把外部 MCP server 的工具变成原生工具，但**只桥接 Tools，不桥接 resources / prompts**（`mcp-client/README.md:10-12`）。

判断线（**二轮评审修正了首稿的一处逻辑矛盾**）：

- **"模型自己办事、不要面板"**：Playwright MCP / chrome-devtools MCP 足够，且**应优先推荐**——那种场景本插件不必存在。
- **"模型自己办事" + "要在面板里看到同一页面"**：**不能用 MCP**。MCP server 通常自己拉起另一个浏览器实例，模型操作的 context 与面板渲染的 context 是**两个**，人机同视图当场失效。此时工具**必须调用本插件的 managed adapter**（同一 context），所以 M2 的工具层是**自研**的。
- 两者是**互斥模式**，不是"并存复用"。若将来真要 MCP 驱动本会话，需要一个受控桥（让 MCP 连到我们的 CDP endpoint）——那是独立的一件事，不在本提案范围。

## 待评审的决策点

| # | 决策点 | 当前倾向 |
|---|---|---|
| D1 | 登录态路线（M4 扩展桥）做不做 | 先不做，只有"确有复用日常登录态的需求"才开 M4 |
| D2 | 座位：右栏 tab 还是全屏 tab | 右栏 tab（与既有插件一致），全屏是展开态 |
| D3 | 是否允许模型在面板未打开时操作浏览器 | **不允许**（人可见是缓解手段之一，见风险③） |
| D4 | 默认 headless 还是带窗口 | headless，`--show-window` 作调试开关 |
| D5 | 浏览器二进制从哪来 | Chrome for Testing，装到插件私有目录，不碰用户系统 Chrome |
| D6 | 工具层自研还是接 MCP | **自研**（M2）：要人机同视图就必须在同一 context 上操作，而 MCP 会另起实例；MCP 只作"不要面板"场景的推荐 |

## 里程碑

- **M0（探针，先做）**：headless 闭环探针 + WS 升级路由可用性验证。**指标量化如下，不达标不开工 M1**：

  | 项 | 基线 | 阈值 |
  |---|---|---|
  | 固定条件 | Chrome for Testing **钉一个版本**（版本号写进探针 README）、`--headless=new`、viewport 1280×800 @ dpr2、单一固定公开外站（无登录、含输入框与链接） | 变更即重量 |
  | 首帧延迟 | navigate 完成后到第一帧 | P95 ≤ 1500 ms |
  | 稳态帧间隔 | 静止页面连续 300 帧 | P95 ≤ 200 ms |
  | 交互延迟 | 点击 → 下一帧反映，重复 30 次 | P95 ≤ 500 ms |
  | 点击命中 | 10 个不同目标 | ≥ 9/10 |
  | IME | 固定串「中文输入法测试一二三四五六七八九十」连续输入，重复 3 轮 | 0 丢失、0 乱序 |
  | 背压 | 客户端人为节流到 1 fps，持续 60 s | 丢帧被正确计数、`bufferedAmount` 峰值 ≤ 4 MiB、宿主 RSS 无持续增长 |
  | 进程回收 | 关闭后 30 s | `<userDataDir>` 对应进程数 = 0 |
  | WS 路由 | 无 token / 错 Origin 各 1 次 | 均被拒 |

- **M1（可独立验收）**：单临时 context、单页、无工具——外站出帧 + 鼠标 / 滚轮 / IME + resize + 关闭回收 + 进程不残留。**砍掉**首稿的 provider 抽象、多标签、持久 profile、完整浏览器 chrome。
- **M2**：多标签、持久 profile、滚动与缩放、下载与文件上传、`browser_*` 工具 + 站点许可门 + 断线重连。
- **M3**：页面标注——在帧上圈一块 / 点一个元素，把标注连同元素选择器与截图坐标变成给模型的结构化反馈（对应 Codex 的 browser comment；这是"真好用"的那一层）。
- **M4（可选，取决于 D1）**：`extension` provider —— MV3 扩展 + `chrome.debugger` 附真实标签页、回连宿主；此时才承诺"复用你已登录的身份"。
- **M5（可选）**：desktop 端走 `WebContentsView`，同一套工具层换渲染面。

## 评审记录

- **2026-09-13 · 首轮（Codex，只读评审）**：结论"方向可行但不可按现稿开工"。已采纳并改稿：
  1. 事实纠正：desktop 当前只用 `BrowserWindow`（`WebContentsView` 非现状）；`puppeteer|playwright` 亦在 `packages/experimental/inspector`（但仍是 devDependency）；tab 注册是"definition + body 两步"；**没有独立滚轮命令**（是 `Input.dispatchMouseEvent({type:'mouseWheel'})`）；**坐标不加 `scrollOffset`**；CDP 默认允许 3 帧在途，"不回 ack 不出帧"需显式 `maxFramesInFlight:1`。
  2. 架构纠正：**绝不用客户端 ack 当 CDP ack**（慢网会冻住 Chrome）——改为立即 ack + 最新一帧覆盖队列 + `bufferedAmount` 限流；**一会话一进程会爆内存**——改为一个进程 + 每会话 `BrowserContext`；**砍掉 M1 的 provider 抽象**（能力不等价，等第二实现再抽）；JSON+二进制混行改为单一二进制 envelope。
  3. 安全补强：Origin 校验、token 单次 / 短时效、日志脱敏、SSRF 防护（`file:` / `data:` / 内网与 metadata 地址 / 重定向 / DNS rebinding）、provenance 与限量、敏感动作逐次确认、按能力构造 CDP 门面（仅禁 cookie 命令不够）。
  4. 范围：M1 缩小到"单临时 context、单页、无工具"；新增 M0 探针；补进程回收、断线重连、弹窗 / 下载 / 权限、SSRF 与 Origin 测试、帧丢弃指标。
  5. 新增「与官方 MCP 客户端的关系」一节。
- **2026-09-13 · 二轮（Codex，定向复核改稿）**：判定"落实无偏差、无新事实错误"，另指出三处收口，已全部采纳：
  1. 报文形状不允许"envelope 或 frameId 状态机"二选一 → **定死单一 envelope**，并补齐 type / 大端长度 / 8 MiB 上限；
  2. 客户端 ack 与覆盖队列构成双重背压 → **删掉客户端 ack**，背压语义收归宿主侧；
  3. **D6 一处逻辑矛盾**：首稿"工具优先复用 MCP"与"人机同视图"冲突（MCP 会另起实例，模型操作的 context 与面板渲染的不是同一个）→ 改为**工具自研、MCP 只作"不要面板"场景的推荐**，两者互斥而非并存；
  4. M0 指标由"有无实测值"量化为可判定的阈值表。

## 实现记录

（随实施追加：相关 Agent Note / 包名 / 提交）

## 验收标准（done 判定）

以独立插件交付，**零官方代码改动**：

1. 两个包可 `dsh plugin add` / `remove` 一条命令装卸；identity triangle 三处同名；`dsh.bundle.patch` 自挂载；`files` 含 `lib/client.js` 与 `cordis.patch.yml`；`dsh.client.inject` 声明官方 client 依赖。
2. `pnpm run build` + `pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 过。
3. **M0 探针指标全达标**（阈值见「里程碑」表，含钉版的 Chrome 版本号与固定测试站点）。
4. 3080 实测：右栏开浏览器 tab → 输入一个**需要 JS 的外部站点**（无登录态）→ 页面渲染、滚动跟手、点击命中 → **中文输入法连续输入 30 秒不丢字不乱序** → resize 后面板不虚化不停更 → 关掉 tab 后 Chrome 进程确实退出（无僵尸）→ 卸载插件后无残留进程（profile 目录保留策略写明）。
5. 工具层（M2 起）：模型 `browser_navigate` 到未批准站点时**被拦并请求批准**；批准后 `browser_read_text` 返回内容且带 provenance 标注；`browser_click` 后截图反映状态变化；**工具操作与面板渲染必须是同一个 context**（人机同视图的机械证明）。
6. 安全探针：WS 路由无 token / 错误 Origin 时拒绝连接；`file:` / `data:` / 内网地址 / 重定向到内网被拦；面板不可见的会话里，工具调用不得静默读取凭据类 API。

## 风险 / 放弃的东西

① **webServer 没有鉴权**，我们开的 WS 是 3080 上的新入口。必须自带 per-session token（生成 → 只注入本会话的客户端 → 连接校验）、**Origin 校验**、短时效 / 单次 token、日志脱敏，并且**只服务本插件的自用流量**——绝不做通用 URL 代理（那等于给 loopback 开一个开放代理）。这条也是 SSRF 防护面：`file:` / `data:` / 内网与 metadata 地址 / 重定向 / DNS rebinding 都要拦。

② **CDP 是一个凭据外泄面**。`Network.getCookies` / `Storage` / `Runtime.evaluate` / 网络响应体 / 下载都能拿到登录态。即使 M1 是隔离 context，M4 的扩展桥会把它变成"你的真实身份"。→ 按能力构造 CDP 门面，高危命令白名单，M4 默认禁读真实 profile。

③ **外部页面 = 不可信上下文**。页面里的文字可以写"忽略之前的指令"。许可门 + provenance 标注 + 限量是缓解手段，**不是免疫**；所以 M2 的工具默认要求人可见（面板开着），敏感动作逐次确认，不做"后台无头批量操作"。

④ **v1 不复用日常登录态**，这是有意的：Chrome 136 之后"附到你日常 Chrome"已被官方安全策略堵死（现状⑤），唯一干净的路是扩展（M4），而扩展要发布 / 加载、会常驻"正在调试此浏览器"横幅、且与手动打开 DevTools 冲突。先不把这份复杂度放进 M1。

⑤ **B2（手工调试端口）降级为调试开关**，不作为独立路线：它相对 M1 的唯一真实收益是"用户肉眼也能看见那个 Chrome 窗口"，而那用 `--show-window` 就够。注意它**必须走端口**——`connectOverCDP` 连不上 pipe。

⑥ **不做 iframe 兜底**。对**本地 dev server** iframe 确实够用，但那与"看外部网站"是两个产品；混在一起会让 UI 出现两套语义（有的页面能读、有的不能读）。若日后真要做"本地预览"，它是另一个 tab 类型，不是降级分支。

⑦ **headless 的渲染保真度有上限**。`--headless=new` 下字体 / GPU / 某些 DRM 内容可能与日常浏览器不同，"我在面板里看到的"不保证与"用户自己浏览器看到的"逐像素一致。写进 README，别让用户以为这是保真镜像。

⑧ **不承诺强风控站点可用**。反自动化检测是军备竞赛，Codex 那条腿同样只在部分站点体验良好；本插件不承诺"任何站点都能操作"。

⑨ **帧协议是实验性 CDP**。`Page.startScreencast` 系列在 CDP 里标 experimental，Chrome 升级可能改形状；`maxFramesInFlight` / metadata 字段都要在 M0 探针里钉一次版本基线。

## 外部事实出处

- Chrome 136 远程调试开关变更（现状⑤）：<https://developer.chrome.com/blog/remote-debugging-port>
- Codex in-app browser（现状⑦）：<https://developers.openai.com/codex/app/browser>
- Codex Chrome 扩展（现状⑦）：<https://developers.openai.com/codex/app/chrome-extension>
- CDP `Page` 域（screencast / ack / maxFramesInFlight）：<https://chromedevtools.github.io/devtools-protocol/tot/Page/>
- CDP `Input` 域（鼠标 / 滚轮 / 键盘 / `insertText` / `imeSetComposition`）：<https://chromedevtools.github.io/devtools-protocol/tot/Input/>
