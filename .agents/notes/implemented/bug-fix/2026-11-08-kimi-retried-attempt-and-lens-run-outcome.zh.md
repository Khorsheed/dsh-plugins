# Agent Note: Kimi 重试过的模型调用不留痕迹，房间运行的结果取自执行记录

Status: implemented

## Problem

会话 75844e33 的房间第 149 轮（Kimi 成员，子会话第 135 轮）是正常完成的：房间记的运行状态是 `done`，成员的 `local-agent/execution` 结束记录也是 `done`。但子会话日志最后多了三步，都是 Kimi 没做过的：一次参数为空的 `novel_extract` 调用，由镜像写入中断占位结果收尾（`isError: true`）；一个只有推理的步骤；还有一个比 Kimi 自己晚 10 秒的轮次结束。Context Lens 里这显示为 #420 请求：没有用量、0.0s、「工具失败 1」，用户因此以为这一轮失败了。

Kimi 自己的 wire 记录了经过。Kimi 第 134 轮第 5 步流式输出了 163 秒后连接断开（`step.end finishReason: error`，随后是 `turn.step.retrying`，`APIConnectionError: terminated`，`delayMs` 618）。Kimi 重试了这一步，wire 里只记了重试那次。调用 id `tool_sl0Gfp7lOo1aRJzIaT5JqDqv` 在 Kimi 的文件里一处都没有。但 Kimi 的 ACP 服务（11-02 二进制里的 `acp-server/src/events-map.ts` 和 `session.ts`）在断开前已经转发了这次失败尝试的思考片段，以及一个 `tool_call`。这个 `tool_call` 是收到第一段流式参数时惰性创建的（`status: pending`），而 ACP 服务在重试时不发任何通知。后面的事出在实时驱动：

- 重试那一步的 wire 折叠调用了 `completeStreams`，它取每种类型最早的未结束流。取到的是失败尝试的思考流，于是后面每条流都往前错了一位。最后一条（"Respond concise."）没人消费，结算时按实时文本写成了一个只有推理的步骤。
- 失败调用占的 `toolSteps` 预留没有任何 wire 行来释放，结算时由 `finalizeOrphanTool` 写出：名字取自 ACP 标题，`args: ''`，结果是中断占位。
- 结算为了这条没人消费的流，等满了 `settleFoldWaitMs`（10 秒）。

这不是 Kimi K3 丢嵌套参数。空 `arguments` 是 `finalizeOrphanTool` 本来就会写的。

Lens 这边，按现在的 store，这一轮的轮次行和成员状态本来就是 `ok`。但成员视图的状态取的是房间的 `room/run-state`，没有用执行结束记录，S8 的规则（Lens 读执行记录）只落实了一半。

## Decision

- **Kimi 转录**（`session-view.ts`）：每条 `turn.step.retrying` 记一条 `retriedAttempts` `{ turn, from, until }`。`from` 是按 `stepId` 找到的被放弃那次尝试的 `step.begin` 时间；`until` 是重试时间加上它声明的 `delayMs`，因为下一次请求在这之前不会发出。时间都用 Kimi 自己的时钟。
- **镜像一遍**（`session-mirror.ts`）：在折叠任何单元之前，把每次被重试的尝试交给新增的可选钩子 `KimiMirrorStreams.discardAttempt`。
- **实时驱动**（`live-driver.ts`）：流和 ACP 工具预留现在记下自己最早到达的时间。`discardAttempt` 丢弃最早到达时间落在窗口内的未封存思考/文本流和尚未写入日志的工具预留，结束它们的预览，释放它们占的预留步号。失败尝试的任何内容都不会被折叠或写入。重试会重新流式输出，它的 wire 步骤就是记录。
- **Context Lens**（`store.ts` 的 `roomTurns`）：子会话写了执行结束记录时，一次运行的结果就取这条记录（`done` / `failed` / `cancelled`）。只有没有结束记录，或者结束是 `uncertain`（被重启打断）时，才退回房间的运行状态。正常完成的执行里失败的工具调用，仍只算它所在请求的工具失败（`toolErrors`），不会把成员视图变成 `failed`。没有记录的轮次保持原有兜底。

## Alternatives considered

- **结算时丢掉 ACP 状态一直停在 `pending` 的孤儿调用。** 否决：能去掉假调用，但去不掉错位的思考流；还会把崩溃时正在流式输出参数的真实调用也藏起来。
- **一看到重试行就丢掉所有未结束的东西，不按时间窗口。** 否决：镜像一遍是节流的，读到这一行时重试可能已经在流式输出，会把重试的流一起丢掉。
- **让 Lens 隐藏或改标只带中断占位结果的请求。** 否决：这是靠填充文本推断。假步骤在哪里写出，就该在哪里修；Lens 只显示日志记录的内容。
- **改写已有的第 149 轮日志。** 不做：日志只追加，修复对新轮次生效。

## Consequences

- 新的 Kimi 轮次中，模型调用在流式输出中途被重试时，不再出现假的失败调用、多余的推理步骤或 10 秒的结算等待。失败尝试的预览会在下一遍镜像读到重试行时消失。
- 第 149 轮和其他已写入的日志里，假步骤仍然在。Lens 把它显示为一个没有用量、有一次工具失败的请求，所在成员视图为 `ok`。
- 房间记为 `failed`、但执行以 `done` 结束的运行，现在显示 `ok`；反过来则显示 `failed`。以执行记录为准。

## Testing

- `packages/local-agent-kimi/tests/live-driver.spec.ts`：用合成 wire 和 ACP 重放这次事故。失败尝试流式输出一段思考和一个 `pending` 工具调用，wire 记下 `step.end error` 和 `turn.step.retrying`，重试流式输出并写入 wire。断言：没有 `tool/call` / `tool/result`，只有一条助手消息（重试的推理和正文），没有失败尝试思考的痕迹，释放后的日志合法。去掉镜像钩子后这个测试失败，并复现出事故里的那个工具调用。
- `packages/local-agent-kimi/tests/session-view.spec.ts`：重试窗口（含退避），以及没见到尝试开始时 `from` 留空。
- `packages/context-lens/tests/room-rounds.spec.ts`：正常完成的执行里有一次出错的调用时，成员视图为 `ok`、`failedScopeCount` 为 0，请求为 `ok` / `toolErrors` 1；执行记录在两个方向上都优先于房间状态；`cancelled` 原样透传；`uncertain` 退回房间状态。
- 对真实日志的只读核对（临时脚本，未提交）：新解析器给出的事故窗口是第 135 轮，从 1794060137099 到 1794060301297，覆盖失败尝试，并比重试的首个 token 早 22 秒结束。把房间日志和子会话日志重放进 Lens store，第 149 轮成员状态为 `ok`，#420 为 `ok` / `toolErrors` 1。
- 未验证：真实 Kimi 轮次里真的发生一次被重试的步骤（需要在 3080 上断一次连接）。

## Related

- [Context Lens 读执行记录](../simplification/2026-11-05-context-lens-reads-execution-records.md)：Lens 这一半补齐的规则。
- [local-agent 写入执行记录](../feature/2026-11-04-local-agent-execution-records-written.md)：现在决定运行状态的那条结束记录（其中的 `outcome`）。
