# Agent Note: Claude Code 成员自己的子智能体镜像成孙会话

Status: implemented

## Problem

Claude Code 成员可以调用自己的 `Agent` 工具（旧版本叫 `Task`），CLI 随即跑一个子智能体。这次改动之前，这些工作进到 dsh 只是成员会话里的一行普通工具调用。M1 步（[Claude 子智能体消息那篇 note](../bug-fix/2026-11-06-claude-subagent-messages-not-member-steps.zh.md)）让子智能体的流事件不再混进成员的步，只留下一个存活计数。

已批准的设计 `proposals/active/2026-11-06-member-cli-subagents.md`（不在仓库里）把每个子智能体镜像成成员下面的孙会话。M2 步（[核心写入模块那篇 note](2026-11-06-cli-subagent-sessions-core.zh.md)）加了写入模块。本篇是 M4 步：Claude Code 接入。

## Decision

新模块 `packages/local-agent-claude-code/src/subagent-mirror.ts` 里是 `ClaudeSubagentMirror`。它只读，写入交给核心的 `openCliSubagent`。

**来源。** 内容取自 CLI 自己的文件，从不取自流。Claude Code 在成员转录旁边写 `projects/<slug>/<cliSession>/subagents/agent-<id>.meta.json` 和 `agent-<id>.jsonl`。

- 目录按 CLI 会话名在各项目目录里找。cwd slug 有损，所以从不自己算（`records.ts` 同一规则）。
- 成员流里的 `Agent`/`Task` tool_use 登记一次调用。meta 的 `toolUseId` 把子智能体和这次调用对上。备用办法：调用的工具结果里也可能带 `agentId`。
- 不是本成员发起的调用，它的 meta 不理。
- 写了一半的 meta 下一遍再读。

**增量读。** 转录按字节偏移读，每次只读完整的行。

- 第一条纯文本 user 行是子智能体的任务，写成孙会话的 `user/message`。
- `isMeta` 行，以及 `attachment`、`api-request*`、`system` 行都跳过。
- `assistant` 行和 tool_result 的 `user` 行交给成员同一个折叠器（`ClaudeStreamParser`）。共用 `message.id` 的行归成一次 API 调用，每次调用经 `execution.mirror` 写成一步。调用重复带的用量只记一次。
- `request/header` 记转录 assistant 行上的模型。
- 子智能体还在跑时，有工具没回结果的调用会挡住这一遍；最后一次调用如果没有工具，也要等着，因为它可能还会再长出块。子智能体结束时全部写出。

**一个子智能体 = 一个会话 = 一次执行 = 一轮。** Claude Code 每次 `Agent` 调用都给新的 agent id，所以没有续用的情况。起因里带调用 id、作为 `name` 的子智能体类型，以及需要时的 `background`。成员那次执行由核心按已镜像的调用找到。

**收尾。**

- **前台。** 成员流里该调用的 tool_result 到达时，读完转录，执行记 `done`，时间取转录最后一行。如果成员这一轮先结算，执行记 `cancelled`，被截断的那次调用标 `interrupted`。
- **后台。** 下面任一条成立就算后台调用：输入带 `run_in_background: true`；工具结果报 `async_launched`/`isAsync`；结果文本以 CLI 的「Async agent launched」提示开头。这种工具结果只是启动通知，不是回答，所以什么也不关。执行在成员这一轮结束后仍然开着，等 meta 报 `finished: true` 时记 `done`。
- **进程没了。** live 路径上，成员进程没了（空闲回收、崩溃、换模型退役、插件卸载），所有还开着的子智能体都记 `uncertain`。
- **exec 路径。** 结算时进程已经退出。后台子智能体如果 meta 报已完成就记 `done`，否则记 `cancelled`。

**接线。**

- **live**（`live-driver.ts`）。驱动给每个成员留一个 mirror。它比一轮活得久，所以后台子智能体一直有人跟踪。`onEvent` 把三样东西交给它：init 事件、成员自己的 assistant/user 事件、子智能体带 `parent_tool_use_id` 的事件。最后一种只用来安排一次合并的读取，内容一律不用。
- 轮次结算时，等成员的轮关闭并持久化之后，再跑 mirror 的 `settleRound`。
- 运行时的 `onDead` 调 `lost()`。
- 有后台子智能体开着时，两轮之间按 `subagentPollMs`（默认 2 秒）轮询重读。`subagentTailMs` 是合并延迟，默认 250 毫秒。两个都是 `ClaudeLiveDriverTimeouts` 上的可选字段。
- **exec**（`claude-cli-provider.ts`）。`ClaudeCliRunSpec` 加可选的 `homeDir`，两处 exec 启动都传。进程退出、成员的结算镜像跑完之后，一个一次性的 mirror 读整条流，以 `processExited: true` 结算。这一步在成员这一轮里面、turn 关闭之前。

所有失败都降级。目录不存在、文件读不了、格式不认识、写入模块抛错，都只记一条警告，子智能体就不镜像，成员这一轮不受影响。

## 关于 Claude 文件格式：已核对与推断

**已核对，只看字段形状**（claude 2.1.x；只读用户自己的 `~/.claude/projects/*/*/subagents/`，不复制任何内容）：

- meta 的字段（`agentType`、`description`、`toolUseId`、`spawnDepth` 为 1 或 2、`requestShape`、`requestNonInteractive`，新版本还有 `isBuiltIn`、`launchedWithDefaults`、`finished`）；
- 每个内容块一条 assistant 行，带 `apiBlockIndex`，共用 `message.id`/`requestId`；
- 每行重复带用量；
- 第一条 user 行是字符串任务，后面跟一条 `isMeta` 行；
- `attachment` 和 `api-request*` 行；
- 成员转录里 `Agent` 的 tool_result 带 `toolUseResult { status: 'async_launched', isAsync, agentId, … }`，文本是「Async agent launched successfully…」。

**不能用：** 抽查的 146 个 meta 的 `requestShape` 都是 `background`，前台调用也一样，所以它不是后台标志。约三分之一的 meta 没有 `finished`，所以它只能当正向信号用。

**推断：**

- 本机抽到的 `Agent` 调用全是异步的，所以没见过前台工具结果的结构化形状。夹具里的 `{ status: 'completed', agentId }` 是猜的，镜像不依赖它。
- stream-json 里结构化结果拼作 `tool_use_result`。镜像两种拼法都认，也认文本提示。
- 假定成员拿到 tool_result 之前，转录已经写盘。
- `claude -p` 进程退出后，后台子智能体可能不会继续跑。
- 成员 CLI 是否像用户的交互式 CLI 看上去那样默认把 `Agent` 放后台，在成员家目录上还没测过。

## Alternatives considered

**加 `--forward-subagent-text` 从流里镜像。** 不采用，与设计一致。流里只有部分对话，也没有逐次用量；转录两样都有。

**成员一轮结束时关掉后台调用。** 设计已否决。后台子智能体比成员的轮活得久，它完成是之后的事。

**live 路径每轮一个 mirror。** 不采用。一轮结束时后台子智能体就会丢掉跟踪。每个成员一个 mirror，读取位置和开着的执行就能跨轮保留，并随进程一起结束。

## Consequences

- 核心没有改动。M4 原样使用 M2 的接口：`openCliSubagent`、`beginExecution`、`beginTurn`、`mirror`、`end`、`persist`，以及已导出的 `appendRequestHeaderIfChanged`。
- 成员自己的步和镜像快照都不变。成员日志每个子智能体多一条 `subagent/catalog`，而且只在有子智能体记录时才写。
- 子智能体的 TodoWrite 和成员一样被共用的折叠器截走，所以孙会话里不会出现它的工具卡片。
- 子智能体再派的子智能体（`spawnDepth` 2）暂不镜像。它的 meta 里 `toolUseId` 指向子智能体发起的调用，不是成员发起的，所以永远配不上。
- Claude Code 的后台子智能体暂不进房间的「后台 N」托盘（设计决定），卡片上照常显示运行中。

## Testing

合成夹具由 `tests/subagent-fixtures.ts` 在测试时生成到临时家目录，不用任何真实内容。

- `tests/subagent-mirror.spec.ts`（10 例）：
  - 前台：配对、步、用量、request header、任务、目录行和幂等；
  - 增量读，不出重复步；
  - 成员一条消息派两个子智能体；
  - 前台被取消、被截断的调用标 interrupted；
  - 后台跨过这一轮仍开着，`finished` 后记 `done`；
  - 只有 `async_launched` 也能认出后台；
  - `lost()` 记 `uncertain`；
  - exec 路径上没完成的后台记 `cancelled`；
  - 降级情形；
  - 同一个 exec 轮带和不带 `homeDir` 各跑一次，断言成员事件除目录行外完全相同。
- `tests/live-driver.spec.ts`（2 例）：
  - live 前台子智能体在轮次中途镜像，成员的结果到了就关；
  - 两个后台子智能体跨过这一轮：一个在 `finished` 后由轮询关闭，另一个被 `disposeAll` 记成 `uncertain`。
- 每个孙会话日志和每个涉及的成员日志都通过 `assertReleasedV4Relationships`。已有镜像快照不变。
