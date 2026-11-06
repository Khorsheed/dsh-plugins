# Agent Note: Kimi 自己开的一轮是一次独立的执行

Status: implemented

## Problem

这是设计 `proposals/active/2026-11-06-member-self-started-rounds.md`（gitignored）的 M4 步。Kimi 成员的后台任务在成员空闲时结束，Kimi 会自己开一轮。这一轮在 wire 上是一条 `turn.prompt`，带 `origin.kind: 'task'` 和 `origin.notificationId`，没有 `promptId`。在本步之前：

- ACP 不推送这一轮，所以没人看着它。
- 11-01 的折叠（[kimi-fold-skips-closed-turns](../bug-fix/2026-10-27-kimi-fold-skips-closed-turns.zh.md)）把这一轮的内容并进人下一次发消息的那一轮。它的回复从不单独出现，也没人被告知。

用户 2026-11-06 定：设计里的建议全部采纳。本步依赖前几步已经合入的部分：

- [member-activity-core-types](2026-11-06-member-activity-core-types.zh.md)：`cli` 调用方和 `self` 起因。
- [kimi-keepalive-background-tasks](2026-11-06-kimi-keepalive-background-tasks.zh.md)：任务在跑时常驻进程不被收回。
- [kimi-prompt-waits-for-self-turn](../bug-fix/2026-11-06-kimi-prompt-waits-for-self-turn.zh.md)：发消息前等自开轮结束，撞车后驱动跟着 wire 读。

房间对这一轮的汇报（`followUpOf`、「后台任务完成后继续」那行字）属于 M5，本步不改 room。

## Decision

**核心：`admitSelf`**（`packages/local-agent/src/index.ts`）。调用形式是 `registry.admitSelf({ childSessionId, provider, cause, taskCallId?, follow })`。

- **准入。** 这一轮 CLI 已经在跑，所以从不排队。`MemberInbox.runNow` 立即写一行 `cli` 账本行，状态直接为 `running`，这一行占住成员的执行位。期间新来的执行在账本里排在它后面。`MemberControls.hold` 同时占住成员的轮次队列，但不取配置租约。
- **拒绝。** 以下情况 `admitSelf` 返回 `undefined`：
  - 该会话不是这个 provider 的成员；
  - 执行位已被别的行占着（已派出的一轮；这种情况归驱动自己的撞车处理）；
  - 有不确定行；
  - 账本写不进去。
- **记录。** 先重新挂上子会话，再写一条 `local-agent/execution` 的 start 记录：调用方 `cli`，起因 `{ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId, startedBy? }`，以及 `task?`。然后运行 harness 的 `follow({ executionId, session, signal })`。它的结果结算账本行和执行的 end 记录，结算时照常等待 settle 报告。
- **`startedBy`** 只顺着已记录的事实取。链条是 `taskCallId`（Kimi 的 `parentToolCallId`）→ 镜像下来的工具调用所在的轮 → 轮次区间包含这一轮的执行（`executionOfToolCall`）。那次执行 start 记录上的 `task` 原样抄过来（`executionTaskOf`），于是这一轮的用量加到当初发起这份工作的任务上。任何一环缺失，两个字段都不写。
- **重启。** 账本载入时仍为 `running` 的 `cli` 行以 `failed` 结束，错误为 `SELF_ROUND_RESTARTED`。它不会变成 `uncertain`，也不挡任何后续执行：这一轮不是谁要求的，没有需要对账的东西。到下一次准入时，`closeReconciled` 以 `outcome: 'uncertain'` 关闭它悬着的 start 记录，不带 `reconciled` 标记。为此，记录器的 `reconciled` 判定现在可以带 `reconciled: false`。

**M5 要用的东西。** start 记录上有 `cause.startedBy` 和 `task`。房间已经观察所有调用方不是 `room` 的 `local-agent/execution` start（`observeMemberExecution`），所以 `cli` 轮次不改代码就进入这条路。`admitSelf` 还返回 `{ executionId, startedBy?, task?, settled }`。`selfExecutionOfTask`（M1 已有）可以按任务 id 找到这一轮。

**转写：`readKimiTranscript(dir, { ownRounds })`**（`session-view.ts`）。

- 自开轮的 `turn.prompt`，如果其 `origin.notificationId` 在 `ownRounds` 里，就按人的消息编号：有待并入的折叠就并入它，否则占下一个轮次号。人下一条消息则开再下一轮。
- 它的提示行仍标 `injected: true`，所以镜像不为它写用户消息。它的各步照常折叠，各自带用量。
- 其余自开轮保持 11-01 折叠。
- `ownRounds` 缺省或为空时，转写与 11-01 版逐行相同。

`ownRounds` 来自成员自己的日志（核心的 `ownSelfRounds`）。它收集 `self` start 记录的通知 id，条件是该记录之后、下一条执行记录之前有 `turn/start`。两处会计算它：

- 镜像（`mirrorKimiSessionDelta`）从它写入的子会话算。
- 计时读取（`readKimiModelTiming`）通过 `LocalAgentTimingAdapter.read` 新增的可选第三个参数拿到成员的事件。

子日志和转写依据的是同一条记录，所以对同一个自开轮两边同时认，或同时不认。

**驱动：观察器与跟读**（`live-driver.ts`，读取函数在 `self-turn.ts`）。

- **什么时候运行。** 每次一轮或一次准备结束（`armIdleTimer`）时启动，托盘读到在跑的任务时（`observeBackgroundTasks`）也会启动。每次查看先对 wire 做 `stat`，间隔 2 秒（`selfTurnObserveMs`），文件变大才读。我们自己有一轮在跑时跳过。没有在跑的任务、也没有未结束的自开轮时停止，进程没了也停止。
- **提交哪一轮。** `nextSelfTurn` 选第一条同时满足以下条件的自开 `turn.prompt`：
  - 在 wire 上最后一条用户提示之后（之前的自开轮归当时那一轮去等）；
  - 时间戳不早于本进程启动（没有时间戳或更早的，属于已经不在的进程）；
  - 还没处理过。每轮只提交一次。
- **哪些轮成为执行。** 只有写明了任务、状态和通知 id 的任务通知才提交给 `admitSelf`。同时还要带上发起任务的工具调用：先从 `tasks/<id>.json` 取，取不到再从 wire 的 `task.started` 取。其他来源（`cron_job` 等）记一条 warn，保持折叠。被拒绝、或核心没有 `admitSelf` 时也一样。
- **跟读。** 先为这一轮开它自己的轮次。然后用 `throughTurn` 折叠 wire，直到 `readTurnAt` 读到这一轮的 `turn.ended`；中间没有结束就出现下一条提示，按 `interrupted` 处理。不写用户消息。之后结算、关闭轮次，如有自动压缩就记下，再上报这一轮的用量（`recordRoundSettled`）。跟读期间占住驱动的轮次链和运行时的 turn 链，所以重新载入或下一条消息都会等它。取消、进程退出或 10 分钟上限都只结束跟读本身。此时会设置 `queuedTurnAbandoned`，下一条消息等 kimi 那一轮结束后再发。

**`throughTurn`**（镜像新选项）。属于更后面轮次的单元会让这次折叠停下，结算折叠也一样；该轮次在边界上的用量记录同样留着。live 轮次现在会传入自己的轮次号。没有这个选项时，结算期间开始的自开轮会被折进子日志从未打开的轮次，日志随之损坏。有了它，那一轮的行会等打开它的那次执行或下一轮来折叠。

## Alternatives considered

**让自开轮像其他调用方一样走账本排队。** 排队的行要等前面的行跑完，但 Kimi 已经在跑这一轮，镜像会落后于 wire，轮次编号也会分叉。设计要求的是插队但不并发。`runNow` 正是这样做的：执行位被占时直接拒绝，不等待。

**被重启打断的这一行也像其他调用方一样标 `uncertain`。** 那样它会挡住这个成员，直到操作者为一轮没人发出的轮次对账。设计明确写了这个例外。

**由驱动凭内存判断哪些是自己的一轮。** 驱动的内存随重启消失，计时读取也不经过驱动。子日志里的 start 记录是两边共有的唯一持久事实。

**对 wire 用 `fs.watch`。** 有工作在跑时每 2 秒 `stat` 一次就够了：自开轮通常持续好几秒；就算一轮很短、在两次查看之间就结束了，它仍会被提交，因为已经结束的轮次也会被跟读。文件监听还需要针对不同平台做处理。

## Consequences

- Kimi 成员空闲时结束的后台任务，现在在子日志里有自己的一轮，并被记录为一次执行：调用方 `cli`，起因 `self`，带 `startedBy` 和 `task`。房间把它当作别处发起的轮次显示（运行卡片、回复、结束边）。汇报给派活人要等 M5。
- **回退。** 旧核心一旦在账本文件里遇到 `cli` 行，就会拒绝整个文件（见核心类型那份 note）。旧 Kimi 包从不调用 `admitSelf`，已写下的 start 记录在旧读者眼里是普通执行。但旧 Kimi 的镜像不认识 `ownRounds`：对日志里已有一轮自开轮的成员，它会把之后每一轮 wire 轮次的编号都排成比子日志少 1，正是 11-01 修掉的那种错位。所以核心和 Kimi 要一起回退，而且只能在还没记下任何自开轮之前回退；否则该成员需要开新会话。家族包要一起部署。
- 只有 `startedBy` 能解析出来时，这一轮的用量才会加到派活的任务上。本步之前启动的任务，或工具调用没有镜像下来的，这一轮没有任务。
- **未在真实进程上验证。** 没有在真机上复现自开轮：那需要一次付费的模型调用加一个后台任务。测试用的是 FakeAcp 和合成的 wire。

## Testing

- `packages/local-agent/tests/run-entry.spec.ts`（真实核心栈），"admitSelf" 块：
  - 立即占位；
  - start 记录是调用方 `cli`、起因 `self`，带 `startedBy` 和抄来的任务，并且写在这一轮的 `turn/start` 之前；
  - 期间来的房间派活在账本里等待，之后作为第 3 轮运行；
  - 第二个自开轮被拒绝；
  - 没有记录在案的链接时，不写 `startedBy` 也不写任务；
  - 非成员、其他 provider、有一轮已派出时都会被拒绝；
  - 失败的自开轮不挡后续执行。
- `packages/local-agent/tests/member-inbox.spec.ts`：`runNow` 占位，排队的行等待，执行位被占时拒绝。被重启打断的 `cli` 行以 `failed` 加 `SELF_ROUND_RESTARTED` 结束，不挡任何东西。
- `packages/local-agent/tests/execution-records.spec.ts`：被重启打断的自开轮以 `uncertain` 关闭，不带 `reconciled`。
- `packages/local-agent-kimi/tests/session-view.spec.ts`：
  - 有记录时，每个自开轮占自己的轮次；
  - 没有记录的那一轮保持折叠，并入之后一个有记录的自开轮；
  - 没有任何记录时（集合缺省、为空，或其中的 id 不在 wire 上），转写与 11-01 版相同。
- `packages/local-agent-kimi/tests/session-mirror.spec.ts`：有 start 记录的自开轮镜像成自己的一轮，它的步带自己的用量，不写用户消息，人的下一条消息开第 3 轮。`throughTurn` 留住后面轮次的行和用量，结算时也一样。
- `packages/local-agent-kimi/tests/self-turn.spec.ts`：`selfTurnPrompts`、`nextSelfTurn`（在最后一条用户提示之后、有时间戳、只处理一次）和 `readTurnAt`。
- `packages/local-agent-kimi/tests/live-driver.spec.ts`，"a self-opened round becomes its own execution" 块：
  - 观察器准入这一轮，并从 `task.started` 读到任务的工具调用；
  - 在这一轮运行期间跟读，读到 `turn.ended` 后结束；
  - 镜像时不写用户消息、带上用量，上报用量，只提交一次；
  - 跟读期间发起的消息在这一轮结束后才发出，且只发一次；
  - 被拒绝的、`cron_job` 的和过期的轮次都不跟读；
  - 没有工作在跑时观察器停止，托盘读取会重新启动它。
- 只读回归（`packages/local-agent-kimi/tests/transcript-regression.ts --baseline <main 的 session-view.ts> <目录>`），2026-11-06 对三份真实 wire 运行（5e754ac5、capcut ffc8cfe1、study-plan 99449949）。设计里提到的 6a56 房间那份 wire 已不在 scoped home 下。没有自己的一轮时，三份都与 main 的读取结果完全相同。把所有通知都算作自己的一轮时，内容不变，只有轮次编号移动。脚本只打印计数和哈希，从不打印 wire 内容。
