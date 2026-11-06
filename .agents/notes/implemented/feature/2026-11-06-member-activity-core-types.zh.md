# Agent Note: 成员后台活动：核心类型与 Kimi 任务读取

Status: implemented

## Problem

2026-11-06 批准的两份设计共用一层核心基础。两份设计都不在仓库里，都放在 `proposals/active/` 下：

- `2026-11-06-member-self-started-rounds.md`（M1 步）。Kimi 成员的后台任务可能在成员空闲时结束，Kimi 随即自己开一轮。这一轮要成为一次有起因记录的执行。房间也要能看到成员的后台任务。
- `2026-11-06-member-cli-subagents.md`（M0 步）。成员 CLI 自己跑的子智能体要变成成员下面的孙会话。每个孙会话作为一次执行运行、带起因，用量计入成员那次执行。

两份设计都加同一个调用方取值，各加一种起因，各加一些读取形状，留给后续步骤填。用户 2026-11-06 决定两份设计一律按建议。本步只落共用词汇和只读的任务列表，不加事件类型，不加观察器，不判定失去联系。

## Decision

**词汇**（`packages/local-agent/src/types.ts`）。全部是已登记类型上的可选取值或可选字段：

- `LocalAgentExecutionCaller` 加 `'cli'`。两份设计共用这一个取值，靠 `cause.kind` 区分。
- `LocalAgentExecutionCause` 加两种：
  - `{ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId?, startedBy? }`：CLI 自己开的一轮。
  - `{ kind: 'cli-subagent', sessionId, callId, executionId?, name?, group?: { index, size }, background?: true, resumed?: true }`：CLI 子智能体的一次执行。
- `LocalAgentBackgroundTask` 含 `id`、`label`、`command?`、`kind: 'shell' | 'agent'`、`startedAt`、`endedAt?`、`state`、`exitCode?`、`startedBy?`、`lostBecause?`、`resultIn?`、`subagentSessionId?`。
  - `state` 类型为 `LocalAgentBackgroundTaskState`：`running | completed | failed | timed-out | stopped | lost`。
  - `lostBecause` 取 `host-restart | process-reclaimed | process-exited` 之一。
  - `subagentSessionId` 出自子智能体设计里的说明：Kimi 的后台子智能体和它那条 `kind: 'agent'` 任务是同一个任务。
- `LocalAgentBackgroundTasks` 为 `{ supported, tasks, processAlive, keepAliveUntil? }`。`supported: false` 时房间整块不显示，不显示「0」。
- `LocalAgentExecutionReading` 加 `subagents?: LocalAgentExecutionSubagentReading[]` 与 `subagentUsage?`。每条子智能体读数为 `{ sessionId, executionId, name?, callUsage?, calls, providerReportedUsage? }`。

**账本**（`member-inbox.ts`）。`CALLERS` 加入 `cli`，`cli` 行能通过校验。重启后，在跑的 `cli` 行和其他调用方的行一样转为 `uncertain`。自开轮的这条重启规则本步不改，归 M4。

**读取函数**（`execution-read.ts`，从包根导出）。三个都是纯函数：

- `executionOfToolCall(events, callId)` 只顺着记录下来的事实走：找到含该 `tool-call` 块的 `assistant/message`，取它的轮次，再取轮次区间包含这一轮的 prompt 执行。缺任何一环就返回 `undefined`。
- `selfExecutionOfTask(events, taskId)` 返回点名这个任务的 `self` start 记录。
- `subagentReadingsFor(executionId, grandchildren)` 收集起因 `cli-subagent` 点名这次成员执行的孙会话执行。它的 `subagentUsage` 只加逐次用量；子智能体的 CLI 自报合计留在它自己那条读数上。`readExecution` 还没有调用它，接入在 M6。

**harness 接口**（`index.ts`、`gateway.ts`）：

- harness 方法 `backgroundTasks?(request)` 是可选的。请求 `LocalAgentBackgroundTasksRequest` 带 `childSessionId`、成员的 `homeDir`、`cliSessionId?`，以及两个查成员子会话日志的异步函数：`executionOfCall(callId)` 和 `selfExecutionOf(taskId)`。核心按需读子会话日志，harness 调用查询函数时才读：有活会话就读它的快照，否则从存储读一次。
- registry 方法 `memberBackgroundTasks(childSessionId)` 的返回：
  - 不是成员，或读取抛错（会记日志）时返回 `null`。
  - harness 没有这个方法时返回 `{ supported: false, tasks: [], processAlive: false }`。
- 网关 Remote `memberBackgroundTasks` 写法与 `memberTools` 相同。

**Kimi**（新文件 `packages/local-agent-kimi/src/background-tasks.ts`，在 `index.ts` 注册；没有改 `live-driver.ts`）：

- `readKimiBackgroundTasks(sessionDir, lookups)` 读 `agents/main/tasks/*.json`。
- 种类映射：`process` 记为 `shell`，`agent` 记为 `agent`。其他种类跳过，例如问用户时写下的 `question` 记录。`detached: false` 的任务属于前台，也跳过。
- 状态映射：`timed_out` 记为 `timed-out`，`killed`/`cancelled`/`stopped` 记为 `stopped`。不认识的状态不列出。Kimi 自己写下的 `lost` 原样保留，不替它编 `lostBecause`。
- 列表包含在跑的、失去联系的，以及 1 小时内结束的任务，按开始时间从早到晚排。
- 只有当列出的任务的状态文件缺 `parentToolCallId` 时才读 wire，从 `task.started` 行补上，先按子串预筛。
- `startedBy` 来自 `executionOfCall(parentToolCallId)`。`resultIn` 来自 `selfExecutionOf(id)`，只对已结束的任务取。
- 只有成员的 live 设置打开时，harness 才报 `supported: true`，因为 `kimi -p` 随一轮结束而退出。`processAlive` 取 live 驱动的 `hasRuntime(childSessionId)`。

## Alternatives considered

**由 harness 自己解析 `startedBy`。** 那样 harness 要自己读 dsh 子会话日志，每家都得各自拿到会话存储，各抄一份轮次区间逻辑。核心本来就掌握子会话日志和 `executionReadingsOf`，所以改由核心传查询函数。Kimi 读取函数因此只依赖文件和回调，是纯函数。

**在方法旁边再加静态声明 `backgroundTasks?: 'live'`。** 设计稿里静态声明和方法用了同一个字段名。一个可选方法就够两种用途：没有方法，表示这家没有后台任务；方法答 `supported: false`，表示这家有，但当前运行方式下没有（Kimi exec）。静态标记表达不了第二种情况。

**现在就用 agent 任务的 `agentId` 填 `subagentSessionId`。** 孙会话 id 是确定的（`<member>.sub.<agentId>`），但要到子智能体设计的 M3 步才会建出这个会话。指向一个还不存在的会话就是猜测，所以这个字段目前只有类型。

**结果并入别的轮次时也填 `resultIn`。** 要做到这一点，得把 wire 里轮内的 `context.append_message` 通知对应到 dsh 轮次号。11-01 的折叠规则和 M4 都会改这套轮次编号。目前只有记录过的 `self` 执行才填 `resultIn`。

## Consequences

- 不加事件类型，所以没有需要先上线的登记。旧读者把 `caller: 'cli'` 和两种新起因当作未知起因。在 lens 的 M8 之前，Context Lens 的起因行显示原始的 kind 字符串。
- **回退风险（更正设计稿）。** 自开轮设计稿说旧核心会「丢弃」`cli` 账本行。实际不是丢弃：`validRow` 会拒绝整个账本文件（「Invalid member inbox; admission is blocked」）。本步不写 `cli` 行，所以眼下没有风险。等 M4 开始写这种行后，如果核心回退到本步之前，这个成员的账本会一直被挡住，直到把那一行删掉。家族包仍须一起部署。
- room 的重启恢复行自带一份调用方联合类型（`packages/room/src/client/member-recovery-view.ts`），本步给它加了 `'cli'`，并为 `recovery.member.caller.cli` 补了中英文文案。这样将来出现 `cli` 行时显示的是文字，不是原始键名。
- 目前没有调用方使用 `memberBackgroundTasks`，房间托盘在 M2。Remote 和 Kimi 读取函数暂时只有测试在用。

## Testing

- `packages/local-agent/tests/execution-read.spec.ts`：
  - `cli`/`self` 执行和其他执行一样读出。
  - 工具调用 → 轮次 → 执行这条链能解析；缺环时返回 `undefined`。
  - `selfExecutionOfTask` 找到对应的 start 记录。
  - `subagentReadingsFor` 按执行筛选，CLI 合计单独保留，只加逐次用量。
  - registry 的 `memberBackgroundTasks`：不是成员返回 `null`；harness 没有方法返回 unsupported；两个查询函数都按活的子会话日志解析。
- `packages/local-agent/tests/member-inbox.spec.ts`：`cli` 行通过校验；在跑的 `cli` 行转为 `uncertain`；未知调用方仍会让账本失效。
- `packages/local-agent-kimi/tests/background-tasks.spec.ts`：只用合成的 `tasks/*.json` 和 wire 行，不从真实会话拷任何内容。覆盖状态与种类映射、近期窗口筛选、跳过的记录（question、前台任务、未知状态、写到一半的文件、输出目录）、用命令作标签、没有任务目录的会话，以及经真实核心读取函数解析的 `startedBy`/`resultIn`。`startedBy` 的用例包括缺调用 id 时从 wire 补的情况。
