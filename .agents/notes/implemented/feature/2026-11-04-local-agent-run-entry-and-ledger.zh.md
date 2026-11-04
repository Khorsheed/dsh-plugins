# Agent Note: 唯一执行入口 `run()` 与每成员执行账本

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）的 S4。此前成员的一轮有三条路：宿主 `subagent` 工具自己 stage intent，然后直接调 `ctx.subagents.startActivation`；成员页输入框从 `MemberInbox` 调 facade `resume`；插件（room、eval）调 facade `start`/`resume`。唯一共享的一层是 `MemberControls` 的内存 FIFO。只有输入框的输入是持久化的，重启后也只有它能恢复。同一成员的一次工具调用和一条输入框输入，排在不同的地方。

## Decision

- **`localAgent.run(request)`**（`types.ts` 里的 `LocalAgentExecutionRequest`）是唯一入口。请求包含：`parentSessionId`、`provider`、`member: { childSessionId, create? }`、`input`（内容块，或一个函数，在执行排到该成员队首时才求值）、`operation`、`caller`、`cause`、`task`、`key`、`callerRef`、`label`、`signal`、`on: { admitted, progress, settled }`。执行持久地入队后即返回 `{ executionId, settled, started }`。首轮还是续聊由核心判断：有委派记录就是续聊，scope 与 cwd 取自记录；预备好的成员按其预备身份开始；其余情况按 `member.childSessionId` 与 `member.create` 开新的首轮。
- **`start` / `resume` / `compact` 改为薄包装**：先同步做原有的那些前置检查（provider 未登记、handle 不属于本会话、续聊时传了 model/effort、不支持配置的 provider 的续聊锁探测、父会话不在线），然后提交到账本，返回 `started`（已发布的 `SubagentRun`）。它们的选项原样传给这一轮（cwd、scope、exec、onAdmitted、onProgress、label、preparedMemberId、reattach）。eval 与 context-guard 不用改，测试照常通过。
- **账本**（`member-inbox.ts`，类 `MemberInbox`，别名 `MemberLedger`）由原来输入框的收件箱推广而来：同一目录 `.member-inbox/`，每成员一个文件（按成员 id 取 sha256 命名），写法同样是原子写。每行是 `{ id = executionId, caller, key?, text?（仅 composer 行有）, operation?, status, createdAt, updatedAt, admittedAt?, settledAt?, error? }`。它是 `MemberControls` 之上唯一的排队层，`MemberControls` 留在它下面充当执行器。**同一成员的行严格按账本顺序、一次只派发一行**：上一行的 run 结算之后，下一行才开始。也正因为这样，惰性输入「在准入时才求值」才成立。
- **执行 id = 账本行 id = 记录 id**：`LocalAgentExecutionIntent.executionId` 把行 id 带进 `ExecutionRecorder.admit`，所以 `local-agent/execution` 的开始/结束记录与账本行指的是同一次执行。
- **key 去重**：账本里已有的 key 不会跑第二次。该行在本进程里排队中或运行中，就返回同一个 handle；已终态，就返回它的结算结果；处于 uncertain，`run()` 报错；排队中或运行中、但本进程里没有对应 handle，也报错。
- **重启恢复只有一处**：加载时，running 行一律转为 uncertain，不管是谁提交的。排队中的 composer 行保留，队列照旧暂停。其他调用方排队中的行没有存输入，加载时丢弃，由调用方用同一个 key 重新提交。只要有 uncertain 行，该成员此后的任何准入都会被挡住。非 composer 调用方在提交时就被拒绝，立即失败，工具调用不会挂在一个被挡住的队列里。
- **`reconcileExecution(childSessionId, executionId, outcome, evidence)`** 是唯一的对账动作。成员页的对账按钮（`gateway.controlMemberInbox`）调的就是它。`cancelExecution(childSessionId, executionId)` 取消排队中的行，或停掉运行中的那一轮。`cancel(childSessionId)` 不变。调用方传入的 signal 在排队中和运行中都能取消这次执行。
- **结算**：行结束时 `settled` resolve，它从不 reject。它带有：outcome；run（已发布时）；`turns`（取自打开的执行记录）；provider settle 上报里的观测值（`observedModel`/`observedEffort`/`cliVersion`）。只有在 run 结束后 `SETTLEMENT_REPORT_WAIT_MS`（2 秒）内到达的上报才算数，否则观测字段缺省，含义是「未记录」。`recordRoundSettled` 现在会把这些观测值交给记录器。
- **宿主 `subagent` 工具**改为调 `run()`：caller `tool`，cause `tool-call`，task `turn:<n>`，callerRef 是调用 id，signal 用工具自己的，label 用 description。工具原先自己做的 stage intent、`ensureChildLive`、`startActivation`、`trackDelegationRun` 都删掉了，复活子会话、登记在途 run、停止都由 facade 负责。`trackDelegationRun` 和 `ensureChildLive` 仍是公开方法，留给其他调用方。
- **成员页输入框**走同一条路：caller `composer`，key 与 callerRef 都是请求 id，cause 为 `{ kind: 'human', sessionId: <所属会话>, via: 'member-composer' }`。重启后重放的排队 composer 行，用存下的原文走同一个派发函数。`queuedMemberRounds` 现在统计账本里的排队行，所以 room 的「协调者忙」判断和「立即载入」都能看到它们。

## 与设计稿的偏差

- `run()` 额外返回 **`started`**（已发布的 run）：包装方法和工具都需要拿到 `SubagentRun`，而按设计稿的形状，结算之前拿不到它。
- **`caller`** 和顶层的 **`label`** 放进了请求。设计稿里账本有 `caller`、请求里没有；`label` 也只在 `create` 下。
- 同 key 的执行正在运行且本进程里有 handle 时，**返回同一次执行**，而不是报错。仍然只执行一次。
- 结算**最多等 2 秒** provider 的 settle 上报，以便带上观测值。设计稿的做法是 run 一结束就发出，那样观测字段几乎永远是空的。60 秒的 `settledRuns` 宽限没有动，随 S5/S7 处理。
- `reconcileExecution` 不为被对账的执行补写 `local-agent/execution` 的 end 记录，子日志里这次执行只有 start、没有 end。
- 按 key 重放一个已结束的执行时，返回 `turns: []`：账本不存轮次区间，要看子会话里的 end 记录。
- composer 的 cause：类型里没有 `inputId` 字段，所以输入 id 记在 `callerRef` 和 key 上。

## Alternatives considered

- **沿用旧收件箱的做法：排队行全部同时派发，交给 `MemberControls` 的 FIFO 排序。** 不采用：那样的顺序取决于谁在异步前置步骤（复活子会话、拼输入）之后先到准入点，而不是账本顺序；惰性输入也会在准入之前很久就被求值。
- **在收件箱旁边另起一个账本文件和格式。** 不采用：同一成员的执行有两个持久存储，正是设计要消除的分裂；推广收件箱只留一个文件，旧文件也能直接读入。
- **持久化所有调用方的输入，重启后所有排队行都能重放。** 按设计稿不采用：room 在准入时才拼提示词，工具调用所在的宿主轮次已经结束，只有 composer 的原文是调用方唯一的来源。

## 用户可见的变化（成员页）

成员页的队列现在显示所有调用方排队中的执行，不再只有手打的输入。没有原文的行显示它的来源（「宿主会话的子代理调用」/「协作间派活」/「插件调用」），也能在这里取消。任何调用方的 uncertain 执行都会带着对账控件出现在这里（用户决定③）。失败的行仍然只列出 composer 输入。队列暂停或有 uncertain 执行时，发给该成员的工具调用或 facade 调用现在会立即被拒绝；以前这类调用要走到 provider，在准入时才被拒。

## Consequences

- 每个跑过一轮的成员都会有一个账本文件，一次性的工具委派和 eval 单元格也不例外。每个子会话一个小 JSON 文件，每成员只保留最近 200 条终态行。
- `tests/tool-factory.spec.ts` 改用临时 homes 目录，不再用 `/tmp/homes`：工具路径现在会写账本，固定的共享目录会让账本行在多次运行之间残留。
- S5（room）现在可以给 `run()` 传 `cause`/`task`/`key`/`callerRef` 和惰性 `input`，并删掉自己对 CLI 成员的队列。S7 把 room 的 uncertain 处理改为走 `reconcileExecution`。

## Testing

- `packages/local-agent/tests/run-entry.spec.ts`（7 例）跑在真实栈上：SessionStore、JSONL 持久化、ToolRuntime、家族工具，加上一个会把轮次挂住的 provider。覆盖：先首轮再续聊（scope 与 cwd 取自记录，惰性输入只求值一次，`admitted`/`settled` 的载荷，记录与账本 id 一致）；key 去重（运行中与结算后，provider 只跑一轮）；排队顺序，以及取消排队中的行（maxRunning 为 1）；调用方 signal 取消排队行，同时 `cancel()` 停掉运行中的那一轮；重启（running 转 uncertain，排队的 room 行被丢弃，工具/room/包装方法调用方以及同 key 重放都被拒，`reconcileExecution` 之后下一轮放行）；工具首轮加续聊，与并发的输入框输入共用一个队列，各自的记录带上各自的起因；`resume` 包装排在运行中的工具轮之后。
- `packages/local-agent/tests/member-inbox.spec.ts`（8 例）按账本语义重写。覆盖：跨调用方的严格顺序；按 id 或 key 取消；暂停；重启时的分流；版本 1 收件箱文件的迁移（行变为以原 id 为 key 的 composer 行，running 转 uncertain，重试仍能去重，文件改写为版本 2）；存储失败；文件损坏。
- 已有用例只在两处做了调整：intent 现在带执行 id 和准入回调（`delegation-facade`、`scripted-provider`）；composer 的起因现在会被记录（`execution-records`）。
- local-agent 测试 495 → 504，全绿。依赖包不改即绿：claude-code 281、codex 277、kimi 315、dsh 246、room 476、context-lens 311、bundle-local-agent 5、eval 1484、context-guard 52。`pnpm check:plugins` 无发现。
- 未验证：没有跑过真实 CLI 轮次，也没有在 3080 实例上验证；成员页没有在浏览器里走查。
