# @khorsheed/dsh-context-lens

[English](README.en.md) | 中文

**上下文透镜**——点开任意一个 turn，看清这一轮每一次模型请求到底装了什么，token 和时间又花在了哪里。

调提示词、写插件、排查「这一轮为什么这么贵、这么慢」时，最想知道的是模型真正收到了什么。上下文透镜按 turn 聚合每一次模型调用，结构化、不漏内容地摊开：system 每一段来自哪里、带了多少工具定义、多少是历史、多少是这次新增，再配上 token 与耗时两个视角，回答「注入是不是太多、缓存为什么断、时间花在哪」。它是给开发者用的工具，2026-10-24 起随开发模式包一起到达。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-request.png" width="640" alt="右栏的上下文透镜请求视角：顶部轮次切换与会话走势，下面是缓存命中与前缀差异，以及 system / tools / history / added 构成">

## 特性

- **从 turn 直接打开**——每个已完成 turn 的动作行多一个图标，点击就在右栏定位到这一轮；会话头部的图标打开最新一轮。
- **请求构成一目了然**——每次请求拆成 system、工具定义、历史、本次新增几块，system 每一段标出来源，可以展开逐字原文。
- **缓存为什么断**——展示 provider 实测的缓存命中与未命中，前缀变化精确定位到具体字符并高亮。
- **找出重复内容**——一键筛出全文相同且至少 40 字符的重复条目，只统计多余的副本。
- **耗时视角**——所选 agent 的总耗时、模型、工具执行和间隙四格，配各 agent 泳道和可排序的工具表，两张表加起来就是实际经过的时间。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-timing.png" width="640" alt="上下文透镜耗时视角：总耗时、模型、工具执行、间隙四格，下方是各 agent 泳道与按执行时间排序的工具表">

- **子 agent 与委派也看得到**——每次委派独立成一个 chip，主对话不重复累加已算在委派里的子 agent 时间。
- **挂载前的历史也能看**——打开面板时顺着会话的落盘日志补出插件挂载之前的 turn，与实时采集不重复。
- **只读、只进内存**——只监听不改写任何请求，数据不写会话日志、不落盘，按会话和全局预算淘汰最旧的记录。

## 安装

上下文透镜随**开发模式**的模式包一起到达，推荐直接装模式包（连同基础体验）：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-dev-suite
```

进阶用法——单独安装：

```sh
dsh plugin --profile web add @khorsheed/dsh-context-lens
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-context-lens
```

本包自行挂载 loader 行（id `context-lens`），重启 web 实例后生效；一个组合里只能挂一次这个行 id。从旧的 request-inspector 迁移时，替换依赖与 bundle 行，不要同时挂载两个身份（见 [CHANGELOG.md](CHANGELOG.md)）。

## 使用说明

### 入口

- **turn 动作行图标**：每个已完成 turn 的动作行（复制/点赞/分享/用量所在行）多一个图标，点击打开右栏并定位到**这个 turn** 的明细（经 `conversation.chat.assistant-actions` 槽，owner prop `messageId` 匹配 turn 的收尾 assistant 消息，失配兜底最新 turn）。
- **会话头部 utilities 图标**：打开右栏并定位到最新 turn。

两处都落在同一个右栏 tab（`context-lens`）；面板内的 turn 切换器（菜单式，带每轮的请求数与 token 合计）可换看本会话任意已采集的 turn，切换时会话视图同步滚动到该 turn（DOM 锚点 `[data-chat-turn]`，未挂载则落到最近的后续 turn，找不到就静默不动）；旁边的「定位到最新」一键回到最新 turn 并把会话滚到底。

### 两个视角

- **请求**：轮次步进和可拖动的会话走势选择请求。详情依次为真实缓存命中/未命中与精确前缀差异、新增输入与捕获输出、system/tools/history/added 构成。可展开逐字原文，或筛选全文相同且至少 40 字符的重复条目。重复字符数只计多余副本；类别和重复筛选不改变分组总量或本次交换。输入预览、思考和工具参数直接可见，展开仍限高。右上角 `{ }` 按钮切换详情 JSON，保留请求列表与指标；没有底部工具栏。

走势跟随所选 agent，不混排主、子请求。前缀变化定位到具体字符，高亮变更范围；首个保留请求显示为比较起点。请求详情的配置带展示模型、思考强度、输出上限与已记录的温度；耗时页按本轮连续配置分段，支持跳回对应请求。缺失字段显示“未记录”，不推测默认值。

请求编号在每个 agent 内累计，起点已知时从 1 开始，跨轮连续；清理旧记录不重新编号，历史不足时显示未知。内部 `seq` 仍作为查询 ID 保留在 JSON 中。

- **耗时**：四格展示所选 agent 的总耗时、模型、工具执行和间隙。独立泳道可跳到请求。工具表可按调用/报错/思考/参数/执行排序，非工具表展开到各次请求及缓存率。两表加总为实际经过时间；并发区间分摊且标注，请求内余量与请求间隙分开。

每次委派独立一个 chip。主对话不重复累加已包含在委派执行中的子 agent 模型时间，无请求的失败运行仍可见。

工具调用卡片展示自身执行结果：失败摘要直接可见，成功正文默认折叠，全文展开后限高滚动。侧栏区分“工具失败”和“请求失败”。输入工具结果在调用 ID 可关联时标注发起请求；执行结果不改变输入上下文构成总量。

### 测量口径

- 分段大小 = **精确字符数**（宿主不暴露分段级 token 数）；请求级 token 总量 = **真实 provider usage**（含 `cacheReadTokens` 实测缓存命中）。构成区的信息提示标注此口径。
- 历史/新增切分 = 对同一 scope 内相邻请求做消息级 diff（durable id 优先，无 id 用内容哈希）。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.7-rc.1`）：✅ 完整——右栏页型 tab 自 0.1.5 起存在（`minHost` 钉在 0.1.5-rc.1），turn 动作行槽 `conversation.chat.assistant-actions` 自 0.1.7-rc.1 起存在；0.1.5–0.1.6 宿主上动作行图标静默缺席，只剩会话头部入口（所有注册走 `ctx.slots.inject`，缺席位不炸 boot）。本包 npm 首发——0.1.0 为首波发布（随本波上架）。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。
- **JSON 展示捕获的组装内容**，不是 adapter 投影后的 wire 字节；未实现的 wire body 占位入口已移除。
- **web 面插件**：headless profile 没有浏览器消费者，宿主半边照常采集并提供 Remote。
- **能力探测降级**：`sessionPersistence` 缺席时日志车道整体关闭（子 agent 明细与历史回溯都关闭，主对话实采不受影响）；`llm/stream`/`system-prompt/assemble`/`session/event` 任一缺席静默降级为更空的面板，不影响启动。

压缩摘要单独分类并可跳转到保留的压缩调用和压缩前请求。日志回放遵守上下文替换，已被压缩或裁剪的旧版本不进入后续上下文及重复统计；未改动的保留尾部继续算作历史。工具结果裁剪显示前后字符数，并在原请求仍被保留时提供跳转。裁剪不生成模型请求，也不改写原调用的执行结果。

## 已知限制

- **正在流式进行的 turn 不实时刷新**：面板是拉取式（打开/切 turn 时取数），进行中的 turn 视图停在拉取时刻。
- **子 agent 日志车道的诚实空态**：one-shot 子运行的 system 原文与工具定义不可见（不落日志），segment 级历史/新增切分只在同一子运行内有意义。
- **日志回溯的 system 段无 section 归因**：重建自日志的 turn，system 提示词渲染为一整块（无 `system-prompt/assemble` 的 section 名）。有模型调用记录的压缩摘要可恢复成独立辅助请求，但输入仅展示被压缩历史，耗时仅是日志记录间隔；缺失的完整输入、流事件和失败尝试不会臆造。其他未记录的辅助调用仍无法恢复。
- **预算裁断会标注**：历史回溯在内存预算装不下更旧的 turn 时从新到旧截断，轮次导航区出现「更早的 turn 受内存预算限制未载入」；空间释放后的查询自动补齐。日志解码失败时（如未知事件类型）空态显示「日志不可读」及原因，与「确实没有数据」区分。
- **直接打开一个子 agent 会话**（catalog'd child session id 进入）看到的是它自己日志的重建视图（one-shot 没有 system/tools），父会话里的同内容在对应 scope 下。
- 面板无主动刷新按钮（留作后续）；尚未实现 adapter 投影后的 wire body 采集。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

### 采集

宿主半边三条只读接缝（不改写任何请求）：

- `llm/stream` waterfall：每次模型调用的完整 `GenerateOptions`（组装层原文，先于 adapter 投影）+ 响应流 block 级计时与 usage；监听器原样转发每一个 chunk。
- `system-prompt/assemble` waterfall：system 段来源归因。
- `session/event`：turn 边界、`subagent/catalog`（子 agent 关联）、tool/call・tool/result（工具执行耗时）、assistant/message（usage 与 turn 收尾消息 id）。

**历史回溯（backfill）**：面板的拉取查询会先顺会话自身落盘日志重建挂载前的 turn——`request/header` 给 config 与完整工具定义、`system/message` 给 system 原文、assistant/message 给响应与 usage（含缓存实测）、tool/call・tool/result 给工具执行耗时。与实采共用同一套宿主 turn 号，绝不重复；带任何实采请求的 turn 整轮以实采为准、不并入日志行。回溯按预算从新到旧回填（live turn 优先占预算），一次到位。日志车道唯一的保真差异：system 段在日志里没有 section 名，渲染为一整块（section 归因是实采车道独有）。

**子 agent 覆盖**：`subagent_dsh` one-shot 是独立子进程（SDK spawn），父进程瀑布看不到它的请求——这类运行从**子会话落盘日志**重建（消息/usage/耗时齐全；one-shot 的 system 原文与工具定义不落日志，面板显示诚实空态，不伪造）。进程内 subagent provider 的请求与主对话同保真度。

数据只进内存（可配置），不写会话日志、不落盘：每会话最近 30 个 turn；历史回溯另占每会话 500 次请求的上限；全部会话的明细文本合计受一个全局字符预算约束（默认约 150MB——明细全文才是内存大头）。预算挤压时最旧的**回溯** turn 先淘汰，实采内容永不被回溯压力挤掉；被预算裁掉的旧 turn 会在轮次导航区标注，空间释放后的下一次查询自动补齐。

### 工作区接入接缝（服务端消费）

五个 Remote 动词（`listTurns` / `getTurn` / `getRequest` / `getTurnTiming` / `getSessionTrend`）都接受一个可选的 `filter: { scopes?: readonly string[] }` 尾参——这是给**可信服务端调用方**的授权过滤接缝：调用方（如把工作区成员 RPC 代理进来的协作插件）从自己的授权事实推出允许访问的 scope 集合，插件把它当不透明白名单逐查询套用。

```ts
// 只授权主对话与 child-a 两个 scope 的一次读取
const { turns, backfill, generation, authorizedScopes } =
  await remote.requestInspector.listTurns(sessionId, { scopes: ['main', 'child-a'] })
```

- **scope 集合必须由可信调用方计算**：`scopes` 是过滤器，不是授权来源——绝不能把浏览器递上来的集合原样转发，必须由服务端从成员资格等授权事实推导。插件不推导、不校验来源；缺省（不传或没有 `scopes` 键）就是今天的本地语义。
- **被排除的 scope 什么都不贡献**：请求行、scope 计数、失败计数、token 合计、计时 lane 与工具名全部只在授权子集上聚合；scope 标识就是 `AgentScopeOverview.scopeId`（主对话恒为 `'main'`，子 scope 用 childId）。turn 行本身（query 预览、起止时间）是会话级元数据，仍然列出。响应原文（`CapturedResponse`）只挂在 `getRequest` 的 `CapturedRequest.response` 上——另外三个动词的面（含未过滤时）都不携带它，过滤之外没有第二条泄漏路径。
- **未授权子 scope 的日志连打开都不打开**：过滤发生在懒加载子日志读取之前——为一次未授权查询打开那份日志这件事本身不会发生（其中的响应记录自然也不会被读）。
- **零授权是显式结果**：带 filter 时结果带 `authorizedScopes`（实际存在且获授权的 scope 列表）；空数组 = 「查询解析为零授权内容」，与字段缺席（未过滤）、`undefined`（未知会话/turn/seq）三分。`getRequest` 命中被排除 scope 时返回 `{ refused: 'no-authorized-content' }`（拒绝确认地址存在，不带任何内容），未知 seq 仍是 `undefined`。
- **保真度元数据复用既有水位线**：turn 行与 scope 行带 `origin`（`'live'` 实采 / `'log-reconstructed'` 日志重建；尚无内容的 scope 不带此字段）；`BackfillInfo` 不动；`listTurns` 新增 `evictedTurnCount`——「采集过又被保留上限逐出」与「从没见过」在会话记录存活时可区分；**盲区**：最后一个 turn 被逐出时会话槽整体释放，整会话逐出与从没见过不可区分。
- **地址语义**：`(sessionId, turnSeq)` 只是 turn 级地址；真实 turn 用宿主 turn 号（跨重启稳定），负数 turnSeq 的 purpose 伪 turn 不是持久地址。请求 `seq` 是进程内单调计数、重启归零——跨调用持有 seq 的一方必须同时持有结果上的 `generation`（实例纪元，挂载时生成），`generation` 一变即作废所有旧 seq，旧 seq 绝不静默命中新请求。
- **保留上限不变**：每会话 30 turn / 500 条回溯请求、全局约 150MB 字符预算照常；过滤只发生在读取路径，不影响采集与保留。
- **本地行为零变化**：不带 `filter` 的调用逐字节保持今天的语义；面板不消费新字段（服务端消费方自行渲染各自状态）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/context-lens`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
