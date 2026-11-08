# Agent Note: Context Lens 显示成员 CLI 自带的子智能体

Status: implemented

## Problem

成员 CLI（Kimi `Agent`/`AgentSwarm`、Claude Code `Agent`/`Task`）会派出自己的子智能体。local-agent 把每个子智能体镜像成成员子会话下面的孙会话（member-cli-subagents M2–M4）：成员上一条目录行；每次调用一条 `local-agent/execution`，起因 `cli-subagent`（成员的 `callId`、它所在的成员执行、类型、AgentSwarm 里的位置、后台与续用标记）。Context Lens 只看一层：子会话的目录行从不跟下去，所以子智能体的请求、缓存和用时在房间的 Lens 和成员自己的 Lens 里都看不到，轮次合计也漏掉了子智能体的花费。

## Decision

Context Lens 沿成员的目录行再往下读一层，并按执行记录放置每个子智能体。外观不变，只给现有视图加内容。

- **读取。** 日志通道的折叠报告每一条 `subagent/catalog` 行（`FoldSink.catalog`）。对外部成员（描述符的 provider 在进程外运行），服务在成员视角旁开一个隐藏的孙视角（`InspectorStore.noteGrandchild`），并在同一次查询里读它的日志（第二遍刷新），请求与执行记录一起到达。成员自己会话上实时出现的目录行同样处理。宿主原生子会话的嵌套仍不显示。子日志的游标与读句柄按打开的会话分开（`<root>\0<child>`），因为同一个孙会话既是房间的视角，也是成员自己 Lens 的视角。
- **放置。** 孙视角的日志里有 `cli-subagent` 执行，它就是 CLI 子智能体。读取时，每次这样的执行由本轮里记录点到它的视角认领，且只在起因指明的成员会话上：它所在的成员执行（`cause.executionId` 属于该视角的运行或请求），或发出 `cause.callId` 的那次成员请求。从不按时间或顺序；记录缺失的孙会话不放置。每轮每个子智能体一个页签，只含被认领执行的请求，所以续用的 Kimi 子智能体在每个调用它的轮次里各出现一次，只带那次调用的请求。房间轮次里页签叫「成员 › 类型」，紧跟在成员后（或在调用它的自开轮之后）；成员自己的 Lens 里叫「类型」，排在主对话后。同一视角下同类型的多个按序编号（AgentSwarm 按其位置）。没有列出的轮次认领的成员 CLI 子智能体进「未归轮」。
- **配对。** 视角带 `cliSubagent`（调用方视角、调用 id、AgentSwarm 位置、后台、续用）与 `delegatedBy`（发出那次调用的请求）。页签行写「由 X #n 派出」并可跳回；调用方的请求行和它的输出里有「派出 X →」。
- **状态。** 取被认领执行的结束记录：没有结束 → 运行中；`failed` → 失败；全部 `done` → 完成；其余（`cancelled`、`uncertain`）→ 已停止（`cancelled`）。执行说明写「起因：成员的 CLI 派出 / 续用的子智能体」。
- **耗时。** 每个子智能体在调用方后面多一条泳道「› 类型」，共用时间轴，在它运行的起止处各一条细虚线；调用方那次工具调用的段落标题写「等 类型」。
- **合计。** 轮次合计每个视角只算一次；`TurnListItem.subagents` 说明其中子智能体的部分（请求、输入、输出，已含在合计里），轮次菜单那一行写出来。会话图里子智能体的请求画在调用方的轮次里，虚线描边。

## Alternatives considered

**按顺序把目录行配到成员的 `Agent` 调用（沿用 `subagent_*` 的先进先出绑定）。** Kimi 的 AgentSwarm 一次调用写三条目录行，续用一条也不写，镜像写目录行可能在调用那一步之前也可能之后；按顺序只是猜。执行记录直接点名调用与成员执行（批 5 S8：Lens 读写下的事实，不推断）。

**把孙视角存在打开它的目录行所在的轮次。** 续用的子智能体在后面的轮次运行，目录行只写一次。读取时按执行放置，才能让每次调用的请求留在发起它的那一轮。

**跨 agent 合并的「全部」请求列表。** 设计中已撤回（用户 2026-11-06 决定）：现有页签和耗时泳道已经能看多个 agent 的推进。

## Consequences

- 房间的 Lens 和成员自己的 Lens 都能逐次看到子智能体做了什么，详情与成员一样完整；它的用时落在成员的时间线上。
- 轮次的数字包含子智能体花费且不重复计算，并说明其中多少属于子智能体。
- 旧的成员日志（没有孙会话）读法完全不变。执行记录被截掉的孙会话日志在房间轮次里不多显示任何东西；在成员自己的 Lens 里仍是普通的已登记子会话。
- 每次刷新到达外部成员时，会读它的孙会话日志：每个子智能体多一次增量读取。

## Testing

- local-agent `tests/lens-contract.spec.ts` 经真实的 `openCliSubagent` 写入器生成 `context-lens/tests/fixtures/local-agent-cli-subagents.json`：一个前台子智能体、一个三路 AgentSwarm（其中一个被截断）、下一轮的一次续用（`UPDATE_LOCAL_AGENT_CONTRACT=1` 重新生成）。
- context-lens `tests/cli-subagents.spec.ts` 经真实服务回放：房间页签、成员 Lens 页签、按调用配对、续用按轮、合计、耗时泳道、两个视图读同一批日志、没有记录不放置。`tests/client-cli-subagents.spec.tsx` 覆盖页签顺序与关系行、「派出 X →」链接、耗时泳道与虚线、会话图的虚线柱、轮次菜单那一行。
- 预览：`examples/workbench/cli-subagents.html?view=<room|member>[&round=2]`。
