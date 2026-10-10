# Agent Note: context-lens 客户端面板——「请求明细」右栏 tab 与两个入口

Status: implemented

## Problem

M1 的宿主采集（见[宿主采集 note](2026-10-09-context-lens-host-capture.md)）把每个 turn 的请求都放上了 `requestInspector` Remote，但用户能打开的东西还不存在。浏览器半边要把已批准的设计稿（`scratch-context-lens/index.html`，内联真实采集数据）忠实地移植到 Remote 动词上——包括 mock 无法表达的部分（turn 切换、活会话身份、按 scope 的 config）——同时满足面板规范（一套按宽度自适应的布局、`--dsh-panel-*` 字号、`--dsw-alias-*` 主题色）与可见性约定（内容绑定会话的 surface 按 preset 组合自隐）。

## Decision

一个右栏 page tab（`context-lens` kind，worktrees 两段式注册：`sidebarRightTabs.register` 注册类型，body 按包 id 挂进 `sidebar.right.pane.tab` 键位），加两个打开它的入口：assistant 消息动作行的图标（`conversation.chat.assistant-actions`，经 `TurnListItem.closingMessageId` 把 `messageId` 解析为 `turnSeq`，兜底最新 turn）与会话头部工具图标（`conversation.session.header.utilities`，最新 turn）。三处注册都走 canvas 样式的 `RegistrationToggle`，挂在 preset 可见性探测上——判据是本包自己的行（bundle patch 根挂 → 对所有会话授予；preset 挂载路径也检查），所有读不到的路径 fail-open。与 canvas 不同，slot 入口也按注册级 toggle（toggle 直接包 `ctx.slots.inject`——它同步返回 disposer）。

当前界面清单见 [Context Lens](2026-10-10-context-lens.md)，该决定替代首版布局，保留本记录的注册和可见性契约。

- **滚动联动**（2026-10-10）：面板切 turn——菜单选择或动作行带参打开——经 DOM 锚点 `[data-conversation-scroll]` + `[data-chat-turn="<hostTurn>"]` 把会话滚到该 turn（精确行优先，否则 DOM 序上最近一个 ≥N 的可见行，即官方 `scrollToTurnAtOrAfter` 的语义），尊重 reduced-motion，所有失败路径静默 no-op。官方没有公开 API；接缝登记为 docs/upstream-seam-registry.md 的 S20。「最新」钮改为滚到底（`scrollTo(scrollHeight)`，兜底为最大 turn 行）。

`<details>`/`<summary>` 行全部走受控状态（summary 的点击被拦下）：jsdom 不执行原生 toggle，且重渲染绝不能把用户折起的状态弹回去。状态是 React 局部的（不用 slot store）：tab 之外没有 surface 读它。截图自查的样例页在 `scratch-ri-panel/`（已被 gitignore）。

## Alternatives considered

- **耗时 tab 只做整轮视角（里程碑任务书的字面读法）**：设计稿的 scope chips 会筛选耗时视图，砍掉会把 chips 困在一个 tab 上。lane 携带筛选所需的一切，所以按 scope 的视图是精确的而非退化的；后续决定规定按 agent 的重叠与间隙口径。
- **`defineStore` slot store（worktrees 模式）**：否决——store 的存在是为了让 badge/标题共享 tab 状态；inspector 的选择状态没有 tab 之外的读者，React 局部状态让组件可以直接用组合 props 测试。
- **turn 切换器保留原生 `<select>`**（第一版）：评审否决——渲染的是 OS 控件而非产品控件；宿主 `Menu` 自带键盘行走、关闭与焦点回收，且能承载 `<option>` 放不下的两行结构（标题 + 计数/token）。
- **按工具拆分直接用 `ToolTiming.tools`**：宿主聚合没有 `scopeId` 也没有分桶细分，按 scope 筛选的耗时 tab 用不了它；落地的是 lane 推导的行（calls · argsMs · execMs）。后续决定将思考分配给调用，等待与文本保留在非工具表。
- **`remote.pluginInventory` 写进 `inject`**：按可见性文档否决——没有该 namespace 的宿主会把整个 client pend 死；探测走 `ctx.get` 且 fail-open。

## Consequences

- token tab 默认选中 scope 的第一个请求（设计稿的 `selected = 0`），不是最后一个；mock 里的「＝弹层」标记随 mock 的聊天列一起去掉了。
- 移植时发现的契约缺口（已上报，未改 types）：`responseSummary` 在宿主侧写死「直接回答」（store.ts 的 `summarizeResponse`），英文 locale 下锚点与卡片标题仍是中文；`AgentScopeOverview` 没有委派运行 seq，0 请求失败运行的 chip 没有 `#seq`；`ToolTiming` 只有整轮口径（经 lane 绕行）；`TurnTiming.buckets.otherMs` 不含请求间间隙（面板自行并入）。
- 包里仍缺带 Compatibility 小节的 `README.md` / `README.zh.md`——npm 发布前清单要求，留给发布里程碑。
- M1 note 记的两个遗留 gate 失败在此关闭：`check:panels` 通过（PanelRoot + 容器查询 + 色板豁免注释），`docs/packages.md` 已收录本包（重新生成）。

## Testing

`tests/client-panel.spec.tsx`用组合 props 假件驱动 tab body：挂载 → listTurns → getTurn → getRequest、turn 切换器、导航参数、scope chips（失败运行页、子会话老实的空 system/tools）、图例筛选、行展开（逐字 + assistant 展开 + 工具网格）、耗时 tab（分桶、按工具、调用行点击跳回、scope 筛选）、请求内 JSON 切换与空/错误态。`tests/client-aggregate.spec.ts` 钉住纯函数层（turn 解析、类别聚合、带间隙并入与 scope 筛选的 lane 归约、格式化）。`tests/client-actions.spec.tsx` 覆盖两个入口；`tests/client-preset-visibility.spec.ts` 覆盖判据的两条授予路径、全部 fail-open 路径与 toggle。截图自查在样例页上跑过（390px 深浅两色 + 800px，正文无横向溢出）。
