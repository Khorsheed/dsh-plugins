# Agent Note: 房间在求助与决策事件上记下任务与执行引用

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）要求以后按任务求和用量时只做相加，不做归属推断。求和的口径是：`task` 为该任务的所有执行（步用量加压缩用量），加上为该任务做的 `room/decision` 调用，再加上起因为 `help` 且 `fromTask` 指向该任务的执行。迁移行 S9 要 room 补上这些引用。S9 之前：

- `room/help` 不记求助方当时在做哪个任务，另一个会话里帮手的执行接不回来。
- `room/decision` 不记它为哪个任务、哪次执行做的决定。决策用量（S6：决策模型用量只在 `room/decision.call` 上）加不到任务上。
- 汇报闸门的 release 轮（`releaseReason: 'timeout'`）找 `decision` 起因时，取的是收件人最近一条 `later` 汇报时机决策。这是猜的：最近一条不一定是这一轮结束的那次扣留。

## Decision

只在已登记的 room 事件上加可选字段，不新增事件类型。没有这些字段的旧事件照旧回放、照旧映射，不为它们补推断。

- **`room/help.task`**（`RoomHelpEvent.task`）：求助方提问时所在的任务（根消息 id）。在 `askHelp`（`packages/room/src/index.ts`）里取 `sendContext(room, asker).task`，与成员发消息用的是同一来源：成员正在跑的投递的任务；房间自己的 agent 则取开启这一轮的那条人类消息的任务。求助方不在任何任务里时不写。
- **`RoomHelpOrigin.task`**：向另一个房间求助时，把求助方的任务作为“求助方房间的任务”带过去（`deliverToRoom`）。因此它会出现在被求助房间的 `room/dispatch.help` 和 `room/help-in` 上。`room/help-in` 上的这个字段指的是**求助方**房间的任务。
- **`help` 起因的 `fromTask`**：`executionFacts()`（`packages/room/src/dispatch.ts`）在 `help` 来源的轮次里，如果请求带了任务，就写 `fromTask: { sessionId: help.room, id: help.task }`。
- **求助方房间里的求助答复轮**（`reportFor: 'help:<id>'`）：投递本身没有 `task` 时，执行的 `task` 取该求助线程自己的 `room/help.task`。这是顺着已记下的引用（求助 id）取的，不是推断。这里不写 `fromTask`：这次执行已经通过 `task` 归到该任务，两个都写，求和时会算两遍。
- **`room/decision.task`**：任务归类 → 消息被归入的任务（`target.id`；新任务就是消息自己的 id）；汇报时机 → 被判的那条投递的任务。
- **`room/decision.runId` / `executionId`**（只用于汇报时机）：回报被判定的那条投递，以及它 running 边上记下的 local-agent 执行（`runExecutionId`）。任务归类是为一条人类消息做的决定（已在 `about.message`），不对应某次执行，所以不带。
- **`room/dispatch.releaseDecision`**：release 轮引用扣下其最早一条待交回报的 `later` 决策（`holdDecision()`：`runId` 等于被扣投递 `reportFor` 的那条汇报时机 `later` 决策）。有就写，不分放行原因。`executionFacts()` 对 `timeout`（或原因未记录）的 release 用它作 `decision` 起因；S9 之前记下的 release 仍按原来的“最近一条决策”读。

### 汇报闸门核对结果（设计稿里的待核风险）

核对了 `report-gate.ts` 和 `DispatchEngine.gateReport`/`holdReport`/`releaseHeld`：

- 扣留只会来自决策模型：`judgeReport` 只有在 `reason: 'model'` 时才返回 `hold: true`。除 `setting`（`each` 设置）和 `plan`（计划节奏）外，每个判定都会在扣留之前写一条 `room/decision`。所以 S9 之后写下的每次扣留都有可引用的决策，之后的 release 轮都会引用它。
- 以下情况没有可引用的决策：
  - 释放 S9 之前写下的扣留（那时的决策不带 `runId`）。`timeout` 退回原来的“最近一条决策”读法；不改写旧数据。
  - `manual`（人点“现在交给”）和 `restart`（重启丢了唤醒计时器）：决策存在，也会被引用，但起因仍按原来写 `human` / `restart`，因为唤醒这一轮的不是决策。
  - 随别的轮次带走而释放的扣留（`markHeldReleased`，原因 `carried`）：不派 release 轮，没有执行需要归属。
  - `setting` / `plan` 的投递从不扣留，也就不会产生 release 轮。
- 不需要新增 `rule` 起因种类。

## Alternatives considered

- **在被扣投递上记下扣它的决策**（`heldBy`）。没采用，因为重复：决策自己的 `runId` 已经等于被扣投递的 `reportFor`，release 轮上一个字段就够了。
- **引用最近一次扣留的决策**。没采用。唤醒计时器由仍待交的第一次扣留设下，之后的扣留不会重设，所以这一轮结束的是最早那条待交扣留的等待。
- **在求助方房间的答复轮上也写 `fromTask`**。没采用：那一轮已经用自己的 `task` 带了任务，求和会算两遍。
- **在答复投递上直接写 `task`**。本步没采用：那会把答复挂进时间轴上的任务树（界面变化）。改在 `executionFacts()` 里映射执行的任务。

## Consequences

- 用户看不到变化。Context Lens 按结构读 room 事件，忽略新字段；它的源码没动。
- 以后按任务求和时，另一个会话里的求助执行（`cause.fromTask`）、决策模型调用（`room/decision.task`）和求助答复都能直接加进来，不用推断。
- `room/help-in.task` 指的是另一个房间的任务。读被求助房间任务的代码不能把它当本房间的任务 id。

## Testing

- `packages/room/tests/dispatch.host.spec.ts`：`executionFacts` 映射 `fromTask`、求助答复取线程任务（投递自己有任务时以投递为准）、release 引用指定决策而不是最近一条；S9 之前的情况不变。
- `packages/room/tests/report-gate.host.spec.ts`：扣留决策带 `runId`（等于被扣回报的 `reportFor`）、任务和执行 id；人工放行引用它。
- `packages/room/tests/help.host.spec.ts`：跨房间求助的线程带求助方的任务，被求助房间的求助投递也带上。
- `packages/room/tests/jobs.host.spec.ts`：任务归类决策写明消息被归入的任务。
- room→lens 契约夹具：用 `UPDATE_ROOM_CONTRACT=1` 重新生成后没有变化，因为它的脚本化流程里不写求助线程，也不写决策。context-lens 测试仍全绿。覆盖缺口：夹具没有替 lens 钉住这些新字段。
