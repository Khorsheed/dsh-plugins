# Agent Note: 核心写入 `local-agent/execution` 开始/结束记录

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）要求每次成员执行都在成员子会话里记下：为什么运行、属于哪个任务、写了哪些轮次、怎么结束、来源有哪些东西不报告，以及 CLI 自报的整轮合计。S0 已经登记了这个事件类型（`2026-11-04-local-agent-execution-event-registered`），S1 负责写入。在此之前，子会话一侧没有这些事实，Context Lens 只能按时间窗推断。

## Decision

凡是经 `withMemberConfigurationRound`（即 `MemberControls.runNow` 准入点）准入的轮次，核心都写一条 `start` 和一条 `end`。实现在 `packages/local-agent/src/execution-records.ts`（`ExecutionRecorder`、`OpenExecution`）。

- **start 写在哪里**：被包装的 provider start 恰好在准入时运行（`onAdmitted` 之后）。如果这时子会话已经在线（续聊、预备成员），start 立刻写入，早于 provider 的任何动作。首轮的子会话由 provider 在 start 里创建，所以记录要等到该轮第一条 `turn/start`：现在每个 provider 都用 `mirror-step.ts` 新增的 `openMirrorTurn(session, turn, transport)` 开轮（claude/codex/kimi/dsh 的 exec 与 live，共 8 处），它会先执行当前执行的钩子。另有兜底，保证 start 不会丢：provider 的 start 返回后立即补写；最迟在写 end 之前补写。
- **钩子表**：钩子以子会话 id 为键，存在 `globalThis` 上的 `Symbol.for` 表里。设计稿的写法是把执行信息随 staged intent 一路传进 provider 的开轮处，那样要穿过每个 exec 和 live 驱动。用钩子表，每个开轮点只改一行；即使 provider 的打包产物和核心各自加载了一份 `mirror-step`，钩子表也是同一个。
- **end**：run 结算时写入。`turns` 取准入水位（准入时子日志的最后 seq）之后新增的所有 `turn/start`，在结算时读取。同一成员的轮次是串行的，这段时间里不会有别人写轮次。`outcome` 的映射是：`completed` → `done`，`aborted` → `cancelled`，其余（包括 start 抛错）→ `failed`；调用方的 signal 已中止时记 `cancelled`。如果 start 在子会话建出来之前就抛错，不留任何记录（即设计稿「准入前失败」的情形）。开过轮的 prompt 执行会等 provider 的 settle 上报，以便带上 `providerReportedUsage`；等待上限沿用现有的 `RUN_PROGRESS_SETTLE_GRACE_MS`，插件卸载时立即写出。压缩执行和没开轮的执行立即结束。
- **cause / task（S1 只有这两个来源）**：`DelegationCallOptions` 新增可选字段 `caller`、`callerRef`、`cause`、`task`，作为 `intent.execution`（`LocalAgentExecutionIntent`）随 intent 暂存，每个 provider 都把它传给准入（`withMemberConfigurationRound(…, intent?.execution)`）。家族工具暂存的是：caller `tool`，`callerRef` 为调用 id，cause `tool-call`（取 `exec.rootCallId ?? exec.callId`），task 为 `turn:<n>`，从调用方会话里该调用自己的 `tool/call` 事件读出；找不到这个事件就不记 task。用户决定④（房间主 agent 用 `subagent` 续聊成员）走的也是这条工具路径。成员页输入框记 caller `composer` 和它的输入行 id，起因留给 S4。facade 调用方没给 cause 时，不记 cause：`LocalAgentExecutionStartEvent.cause` 改为可选，含义是「未记录」。这是对 S0 形状唯一的一处放宽，目前还没有读者。
- **providerReportedUsage（用户决定②）**：`recordRoundSettled` 新增可选的 `providerReportedUsage`，只填 CLI 自己报告的合计。Claude（exec 与 live）取 `result` 事件的 `usage`。Codex exec 取 `turn.completed` 的 usage；不取 rollout 兜底，因为那是最后一次调用的用量。Codex live 取线上线程总量相对本轮的差值；不取逐次的 `last`，也不取 rollout。Kimi 和 dsh 不报：它们 settled 的 `usage` 是镜像下来的逐次用量之和，正是决定②不许抄写的东西。
- **`LocalAgentHarness.unrecorded`**（`LocalAgentUnrecordedDeclaration`：`exec` / `live` / `compact`）原样照抄到 end 记录。transport 来自 `openMirrorTurn` 的参数；压缩执行用 `compact`；没开轮的 prompt 执行不声明；开了轮但没经过开轮函数的（第三方 provider）取 `exec` 与 `live` 的并集。

## 各家声明与依据

| Harness | exec | live | compact | 依据 |
|---|---|---|---|---|
| claude-code | internal-calls | internal-calls | internal-calls, compaction | `tests/fixtures/stream-json.sample.jsonl`（真实 CLI 录制）：result 的 `modelUsage` 记 735 输入 / 148 输出，`result.usage` 记 4 / 129，流里没有任何 assistant 事件能对上差额；解析器没有 `compact_boundary` 分支；provider 忽略 `operation`，`/compact` 按普通 prompt 跑，也不写 `local-agent/compaction`。 |
| codex | call-boundaries, per-call-usage, internal-calls | internal-calls | — | exec：用量只在 `turn.completed` 上，挂在最后一个非工具行（`appendCodexResponse`）；`parseCodexJsonStream` 没有压缩类条目。live：自动压缩是不带用量的 `contextCompaction` 条目（`recordRoundContext`）；调用边界在线上有（`thread/tokenUsage/updated`）。手动压缩会记下用量。 |
| kimi | internal-calls | — | — | `session-view.ts` 跳过会话级 `usage.record`（压缩调用的消耗），理由是压缩事件会带上它；但只有 live 驱动写这个事件（`readKimiCompaction`），所以在 `kimi -p` 上这部分消耗就丢了。 |
| dsh | internal-calls | internal-calls | internal-calls, compaction | `session-mirror.ts` 只拷贝 user/assistant/tool/step 事件，子 dsh 的 `compaction/start\|summary\|end` 及其摘要调用都不会过来；provider 忽略 `operation`。 |

这些声明导出为常量（`CLAUDE_CODE_UNRECORDED`、`CODEX_UNRECORDED`、`KIMI_UNRECORDED`、`DSH_UNRECORDED`），由镜像快照锁定。

## Alternatives considered

- **按设计稿原话，把执行信息穿过各 provider 传到开轮处**：没有采用，改用上面的钩子表。落点相同，改动少得多。
- **由核心预先创建首轮子会话**：没有采用。这会改变会话由谁创建，连带改变 descriptor 的顺序和 subagent catalog 行。
- **各家都拿 settled 的 `usage` 当 `providerReportedUsage`**：没有采用。对 kimi 和 dsh 来说，那只是逐次之和的抄写。

## Consequences

- **预计没有用户可见的变化**：目前没有任何地方读这些记录（lens 在 S8 读，room 在 S5/S6 读）。成员页 `MemberInbox` 的 execute 回调多收一个输入 id。
- **部署顺序**：S0 上线 3080 之前，S1 不得上 3080。写这个类型的版本，必须跑在已经登记它的版本之上。
- 镜像快照现在锁定了记录的位置，见第二个提交。
- **S4/S5** 会用 `run()` 的请求取代这几个选项字段，并接入 room；记录的形状不变。

## Testing

- `packages/local-agent/tests/execution-records.spec.ts`（10 例）走完整链路：facade → 准入 → `openMirrorTurn` → 真实 JSONL 持久化。覆盖：首轮（start 在 descriptor 之后、`turn/start` 之前；end 在 `turn/end` 之后，带 turns、outcome、声明和合计）；续聊（start 早于 provider 开轮）；压缩（无轮次、用 compact 声明、不等待）；取消轮；出错轮；spawn 失败；迟到的 settle 上报；成员页输入框。每份存储日志都能经宿主读取器读回，通过 `assertReleasedV4Relationships`，且不产生隔离文件。记录器单测覆盖：有界等待；没有开轮函数时 start 的兜底（声明取并集）；子会话不存在时不留记录。工具路径单测覆盖 `toolCallExecution`。
- 8 个 provider 镜像快照都在一个打开的执行里跑，`expectValidReleasedLog` 全部接受，包括 live 的完成轮与取消轮，以及 kimi wire fold 在尚未关闭的轮内写下的 end。
- 未经真实 CLI 验证：claude 的 `internal-calls` 依据的是录制样本，不是新跑的一轮；codex exec 的 `internal-calls` 依据的是解析器支持的条目类型，没有在 exec 模式下实际观察到自动压缩。
