# 请求明细（Request Inspector）

按 turn 聚合每一次模型调用，把「这次请求到底装了什么」结构化、不漏内容地展示出来：system 每段来自哪里、带了多少工具定义、历史上下文多少、本次新增多少——外加 token 分布与耗时分布两个视角，回答「注入是不是太多、缓存为什么断、时间花在哪」。

## 入口

- **turn 动作行图标**：每个已完成 turn 的动作行（复制/点赞/分享/用量所在行）多一个图标，点击打开右栏并定位到**这个 turn** 的明细（经 `conversation.chat.assistant-actions` 槽，owner prop `messageId` 匹配 turn 的收尾 assistant 消息，失配兜底最新 turn）。
- **会话头部 utilities 图标**：打开右栏并定位到最新 turn。

两处都落在同一个右栏 tab（`request-inspector`）；面板内的 turn 切换器（菜单式，带每轮的请求数与 token 合计）可换看本会话任意已采集的 turn，切换时会话视图同步滚动到该 turn（DOM 锚点 `[data-chat-turn]`，未挂载则落到最近的后续 turn，找不到就静默不动）；旁边的「定位到最新」一键回到最新 turn 并把会话滚到底。

## 两个视角

- **Token 分布**：左侧请求列表（`#序号 · 响应摘要`、输入/输出 tok、耗时、实测缓存命中+迷你条），右侧选中请求——明细头 config 行（config · provider/model · maxTokens，**config 在 scope/请求级**，子 agent 模型可能与主对话不同）、类别堆叠条与图例（点击筛选明细）、**输入四段式**：system（按 `system-prompt/assemble` 的 section 名归因）/ tools 定义（两列网格）/ 历史上下文（默认折叠）/ 本次新增（默认展开，含上一响应及其工具返回，响应行带来源标签「← #N 的响应」），其后的**输出**段是本请求自己的响应原文（reasoning / text / 逐条工具调用；头部即本次响应摘要 · 输出 tok · 耗时；流式中显示「进行中」，block 前失败显示 error，未捕获不编造）。每行可展开逐字原文。
- **耗时分布**：整轮视角六类切割（模型等待/模型思考/工具参数/模型输出/工具执行/其他开销）+ 严格按序时间轴 + 按工具拆分 + 逐次调用行（点击跳回 Token 分布的对应请求）。

主/子 agent 导航：每次委派运行独立一个 chip（`▸ #序号 标签 ✓/✗`），不合并且不按描述分组；失败的委派（0 次模型调用）有独立状态页——空本身就是诊断信息。

## 测量口径

- 分段大小 = **精确字符数**（宿主不暴露分段级 token 数）；请求级 token 总量 = **真实 provider usage**（含 `cacheReadTokens` 实测缓存命中）。面板页脚标注此口径。
- 历史/新增切分 = 对同一 scope 内相邻请求做消息级 diff（durable id 优先，无 id 用内容哈希）。

## 工作原理

宿主半边三条只读接缝（不改写任何请求）：

- `llm/stream` waterfall：每次模型调用的完整 `GenerateOptions`（组装层原文，先于 adapter 投影）+ 响应流 block 级计时与 usage；监听器原样转发每一个 chunk。
- `system-prompt/assemble` waterfall：system 段来源归因。
- `session/event`：turn 边界、`subagent/catalog`（子 agent 关联）、tool/call・tool/result（工具执行耗时）、assistant/message（usage 与 turn 收尾消息 id）。

**历史回溯（backfill）**：面板的拉取查询会先顺会话自身落盘日志重建挂载前的 turn——`request/header` 给 config 与完整工具定义、`system/message` 给 system 原文、assistant/message 给响应与 usage（含缓存实测）、tool/call・tool/result 给工具执行耗时。与实采共用同一套宿主 turn 号，绝不重复；带任何实采请求的 turn 整轮以实采为准、不并入日志行。回溯按预算从新到旧回填（live turn 优先占预算），一次到位。日志车道唯一的保真差异：system 段在日志里没有 section 名，渲染为一整块（section 归因是实采车道独有）。

**子 agent 覆盖**：`subagent_dsh` one-shot 是独立子进程（SDK spawn），父进程瀑布看不到它的请求——这类运行从**子会话落盘日志**重建（消息/usage/耗时齐全；one-shot 的 system 原文与工具定义不落日志，面板显示诚实空态，不伪造）。进程内 subagent provider 的请求与主对话同保真度。

数据只进内存（可配置），不写会话日志、不落盘：每会话最近 30 个 turn；历史回溯另占每会话 500 次请求的上限；全部会话的明细文本合计受一个全局字符预算约束（默认约 150MB——明细全文才是内存大头）。预算挤压时最旧的**回溯** turn 先淘汰，实采内容永不被回溯压力挤掉；被预算裁掉的旧 turn 会在页脚标注，空间释放后的下一次查询自动补齐。

## 工作区接入接缝（服务端消费）

四个 Remote 动词（`listTurns` / `getTurn` / `getRequest` / `getTurnTiming`）都接受一个可选的 `filter: { scopes?: readonly string[] }` 尾参——这是给**可信服务端调用方**的授权过滤接缝：调用方（如把工作区成员 RPC 代理进来的协作插件）从自己的授权事实推出允许访问的 scope 集合，插件把它当不透明白名单逐查询套用。

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

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.7-rc.1`）：✅ 完整——右栏页型 tab 自 0.1.5 起存在（`minHost` 钉在 0.1.5-rc.1），turn 动作行槽 `conversation.chat.assistant-actions` 自 0.1.7-rc.1 起存在；0.1.5–0.1.6 宿主上动作行图标静默缺席，只剩会话头部入口（所有注册走 `ctx.slots.inject`，缺席位不炸 boot）。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.0-rc.1）。
- **wire body 视图是 0.1.2+ 探测增强**：字节级请求体依赖 `deepseekLlmApiExtensions.prepare`（且仅 deepseek adapter），探测不到时底部该视图灰显，主功能不受影响。
- **web 面插件**：headless profile 没有浏览器消费者，宿主半边照常采集并提供 Remote。
- **能力探测降级**：`sessionPersistence` 缺席时日志车道整体关闭（子 agent 明细与历史回溯都关闭，主对话实采不受影响）；`llm/stream`/`system-prompt/assemble`/`session/event` 任一缺席静默降级为更空的面板，不影响启动。

## Known Limitations

- **正在流式进行的 turn 不实时刷新**：面板是拉取式（打开/切 turn 时取数），进行中的 turn 视图停在拉取时刻。
- **子 agent 日志车道的诚实空态**：one-shot 子运行的 system 原文与工具定义不可见（不落日志），segment 级历史/新增切分只在同一子运行内有意义。
- **日志回溯的 system 段无 section 归因**：重建自日志的 turn，system 提示词渲染为一整块（无 `system-prompt/assemble` 的 section 名）；aux 请求（compaction / session-title）不落请求日志，不出现在历史 turn 里。
- **预算裁断会标注**：历史回溯在内存预算装不下更旧的 turn 时从新到旧截断，页脚出现「更早的 turn 受内存预算限制未载入」；空间释放后的查询自动补齐。日志解码失败时（如未知事件类型）空态显示「日志不可读」及原因，与「确实没有数据」区分。
- **直接打开一个子 agent 会话**（catalog'd child session id 进入）看到的是它自己日志的重建视图（one-shot 没有 system/tools），父会话里的同内容在对应 scope 下。
- 面板无主动刷新按钮（留作后续）；wire body 视图待宿主 0.1.2+ 能力接入。
