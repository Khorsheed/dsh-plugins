# Agent Note: request-inspector 请求采集核心 — 三条宿主内通道 + 子代理日志通道

Status: implemented

## Problem

请求明细面板需要回答「这一轮每一次模型调用到底发了什么」:system 分段归因、工具定义、历史/新增切分、六桶耗时、子代理运行的请求。宿主侧唯一全保真的观察点是 `llm/stream` 瀑布,但三个事实让「挂个监听器」并不够:

- **`subagent_dsh` 一次性子代理跑在全新子进程**(packages/subagent/subagent-dsh-sdk/src/run.ts),父进程的瀑布永远看不到它的请求,只能从子代理落盘的会话日志重建。
- **LOOP 构造的请求是深冻结的**(`markAgentLoopRequest`),采集端任何写入都会 throw;采集必须纯只读,且采集自身的 bug 绝不能打断模型路径。
- **system 提示词的分段归因没有直接载体**:`llm/stream` 的 `GenerateOptions.messages[0]` 只有渲染后的整段文本,section 边界活在 `system-prompt/assemble` 瀑布里,而两者都没有对方的标识。

## Decision

四条通道汇入一个内存环形存储(`InspectorStore`,会话 → turn → agent scope → request):

- **`llm/stream` 搭链**:监听器返回一个 tee 生成器,逐项 `yield` 原 chunk(绝不改写、绝不碰冻结的 options),同时记录 block-start/end 计时、usage、tool-call 身份。采集侧任何 throw 都被捕获降级:setup 失败退回裸 `next()`,中途失败只丢后续观测。
- **`system-prompt/assemble` 只读旁听**:记录 `next()` 之后的 assembly(sections + variables),按宿主的渲染规则自行插值后与请求里的 system 消息做**内容比对**——精确命中才拆成 section 行,不中则保留单行不归因。归因是展示层增强,绝不伪造。
- **`session/event` 承载关联**:`turn/start|end` 开闭 turn,`user/message` 提供 query 预览,`assistant/message` 提供 `closingMessageId` 与历史行的生成耗时回填,`tool/call → tool/result` 按 callId 配对出工具执行时长(归属到响应里发出该调用的请求),`subagent/catalog` 开子代理 scope 并按序绑定待定的委派调用。
- **子代理日志通道**:`ctx.get('sessionPersistence')` 结构探测后 `open(childId, 'read')` 增量读取(游标续读),把事件折叠成请求——每个带 usage 的 `assistant/message` 是一次成功请求,`assistant/attempt` 是一次失败请求。一次性子代理日志**没有** `request/header` 与 system 消息,这些字段保持诚实的空态(config `{}`、system/tools 空数组),不编造。同一 scope 两条通道互斥:live 通道先进则日志通道退出,反之亦然(`live`/`logFilled` 标志)。
- **purpose 请求进入伪 turn 桶**:带 `purpose`(compaction / session-title)的辅助调用即使发生在 turn 中途也不是会话步骤,按 purpose 聚合到会话级伪 turn;无 purpose 又无开 turn 的散调用进 `ad-hoc` 桶(挂载时正在进行的 turn 在 `turn/end` 时把桶里的实采请求收编进该 turn 的记录)。
- **响应锚点是结构化数据**:`responseSummary` 为 `{kind:'tool', name, hint?, more?} | {kind:'text'} | {kind:'none'}`——宿主不产出任何展示文案,「直接回答」这类文案由面板按 locale 字典渲染,工具态按设计稿渲染为 `name:hint`。scope 携带会话内按创建顺序的 1 基序号 `scopeSeq`,委派 chip 的 `#N` 锚点因此不再依赖首个请求的 seq(0 请求的失败运行也有锚点)。
- **历史回溯与实采共用宿主 turn 号**:`turn/start` 的 `turn` 载荷就是稳定序号(每会话稠密递增,跨重启由 turnBoundary 投影续号),实采 turn 的 `turnSeq` 直接键在它上面,日志重建的 turn 同键——两车道天然不重复。伪 turn 桶占用负数地址段(-1、-2…),永不与宿主号冲突。重叠规则:带任何实采请求的 turn 整轮以实采为准(日志行不并入);回填从新到旧填,单个超大 turn 只跳过不中止。每个会话的回溯读在水位为 partial 时可重试(读只是一次 zstd 解码),complete 后不再重读。
- **预算模型**:内存大头是明细全文(~200KB/请求),不是行数。留存 = 每会话 30 个 turn 的窗口(淘汰顺序:最旧的回溯 turn 先于实采 turn)+ 每会话 500 次回溯请求 + 全局 150M 字符的明细文本预算(超压时跨会话淘汰最旧的回溯 turn,实采永不让位)。水位对客户端诚实:`listTurns` 返回 `{turns, backfill:{state, reason?}}`,state 为 none/partial/complete/broken——「确实没有」「日志不可读」「预算截断(可再补)」三种空态分开。
- **历史/新增按同 scope 前一请求做最长公共前缀 diff**:有 id 用 id,无 id 用内容哈希;压缩改写后的前缀整体判为新增——这正是模型眼里变化的部分。
- **淘汰以 turn 为粒度**:`maxTurnsPerSession`(默认 20)与 `maxRequestsTotal`(默认 200)都只淘汰已关闭的 turn;含在途流的 turn 跳过,因此上限在流未收口时是软上限。

耗时模型:请求六桶(wait = 派发→首 chunk;reasoning/toolArgs/text = 对应 block 求和;toolExec = tool/call→result;total = 派发→流收口);turn 视图把每个请求的 [startedAt, settledAt] 划分成严格有序的 lane(wait + 各 block + 间隙与收尾计为 other),工具执行 lane 按真实时刻插入,按工具聚合时 argsMs 取自该调用 tool-call block 的生成耗时。

## Alternatives considered

- **自行解析 `session.v4.jsonl.zstd`(移植 zstd 帧扫描)**:参考脚本 extract-novel.mjs 走的就是这条路。但持久化根目录布局、格式版本链与撕裂尾恢复都是 `sessionPersistence` 的实现细节,插件直读文件等于复制一份会漂移的私有协议。代价是读路径对未知且未标 ignorable 的事件类型拒绝整个日志——此时 scope 保持空请求并记一条 warn。
- **用 scope key 反查 session(给 assembly 归因)**:`carrierKeyOf` 能拿到 agent 实例再读 `.id`,但那是 agent-loop 的私有选型;内容比对与 scope 机制完全解耦,重复 prompt 命中错误归因也无害(内容相同则归因相同)。
- **attempt 事件忽略(与参考实现一致)**:改为纳入——失败/重试的调用正是面板要暴露的,finish chunk 里的 failure 提供了错误文本。

## Consequences

- 范围纪律:已知子代理会话的实时事件与请求只进父会话的 scope;直接打开子会话时,面板经回溯车道展示其自身日志的重建视图(one-shot 子会话无 system/tools 的诚实空态)。
- 读子代理日志发生在面板查询时(listTurns/getTurn/getRequest 先增量刷新),无后台轮询;`SessionPersistenceNotFoundError` 视为瞬时(子进程尚未落盘),其余读失败对该子代理永久标记 broken,不再重试。
- `scripts/check-plugin-independence.ts` 的 `ALLOWED_EDGES` 增加了 `'request-inspector': ['@khorsheed/dsh-client-ui-panel-kit']`:脚手架已声明该 devDep(面板套件,client 里程碑使用),这是检查器自身注释指定的登记处。
- 两个既有门禁红灯与本改动无关,留给各自里程碑:`check-panels`(M0 client 尚无 PanelRoot)与 `generate-package-map`(docs/packages.md 未含新包)。
