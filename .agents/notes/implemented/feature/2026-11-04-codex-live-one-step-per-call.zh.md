# Agent Note: Codex live 每次模型调用写一个子会话步

Status: implemented

## Problem

批 3（[共用镜像写入器](../simplification/2026-11-02-local-agent-shared-mirror-writer.zh.md)）已让 Claude live 按 API 调用分组镜像，但 codex live 驱动仍然每个 app-server 条目写一步：一次先思考、说一句、再跑两条命令的模型调用会变成四步，用量挂在碰巧排在最后的那个条目上。Context Lens 只好把没有用量的外部步拼回一次请求（`log-lane.ts` 的 `deferred`/`flushDeferred`/`joinCall`），成员自己的会话里一次调用也显示成一堆零散卡片。批 5（设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里，迁移表 S3）要求 codex live 像 Claude 一样把一次调用写成一步。codex exec 不变：它的 JSON 流里没有调用边界，[S1](2026-11-04-local-agent-execution-records-written.zh.md) 已把它声明为 `call-boundaries` 未记录。

## Decision

`packages/local-agent-codex/src/live-driver.ts` 改为记录本轮的模型调用（`CodexCall`），取代按行的账本（`lines`/`folded`/`usageByLine`/`mirrorUpTo` 都已删除）。

- **调用边界。** 一条 `thread/tokenUsage/updated` 通知结束一次调用。codex 在一次调用的最后一个条目之后发出该调用的用量，工具输出也在它之前（下一次请求要用到这些输出）；所以上一个边界之后首次出现的条目都属于下一个边界结束的那次调用，边界上的 `tokenUsage.last` 就是这次调用自己的用量。依据：真实 codex rollout（`~/.codex/sessions/…`，codex-cli 0.163.0）里，每个 `token_count` 都记在该调用的 `function_call_output` 之后，与 `token_usage_record` 一一对应；用真实的 `codex app-server` 对接本地模拟的 Responses 服务（不花模型费用）跑一轮，通知顺序是：`item/started reasoning` → `item/completed reasoning` → `item/started commandExecution` → `item/completed commandExecution` → `thread/tokenUsage/updated`（last 100/10，total 110）→ `item/started agentMessage` → 增量 → `item/completed agentMessage` → `thread/tokenUsage/updated`（last 130/6，total 246）→ `turn/completed`。
- **重复读数不算边界。** codex 会把没变的读数再发一遍（一份真实 rollout 的 3994 个 `token_count` 里有 37 个与前一个总量相同，其中一些落在调用中间，夹在思考条目和它的工具调用之间）。线程 `total` 与本运行时上一次读数相同的通知（`CodexLiveRuntime.lastUsageReading`，所以从上一轮带过来的也算）既不结束调用，也不改变本轮自己的合计（`threadTotalBefore`）。没有数值 total 的通知从不去重。
- **归属。** 条目在首次出现时（`item/started`、第一个增量或完成通知）加入当前打开的调用；边界之后的第一个条目才建立新调用。回显的 `userMessage` 和 codex 自己的 `contextCompaction` 不是模型输出，不加入任何调用。如果条目所属的调用已经写出（完成通知晚于调用），它加入当前打开的调用。
- **写入。** 一次调用在边界到达、且它开始的每个条目都已完成之后写出（发布日志的读取器要求每个已声明的工具在 `step/end` 前有结果）：经 `appendMirrorContent` 写一条 `assistant/message`，按首次出现顺序列出所有块，带该调用的用量一次；然后是每个工具的 call/result；然后 `step/end`。期间开始流式输出的下一次调用先在浏览器里预览，等前面的调用写完再开自己的步。`turn/completed` 以及取消或失败后的结算，把剩下的调用逐个写出；完成通知始终没来的流按它的实时文本写入，只有在非完成轮次里、消息含有这种被截断的块时才标 `interrupted`。
- **实时文本。** 调用的第一个流打开调用的步；同一调用后面的流加入这一步，作为子项发布（`turn:step:itemId`），与 Claude live 完全一样，所以文字照旧逐字出现。没有实时流时，每个持久快照都带上这次调用到目前为止已打开的全部块。
- **流时间。** 一次调用只有一条消息，它的 stream 记录由所有块推出，因此覆盖整次调用：没有 `item/started` 的流式条目，生成窗口取第一个增量到完成（以前没有）；流的开始时间取增量到达的时刻，而不是重放的时刻（轮次开启前到达的通知会先缓存再重放）。

不变的部分：codex exec（`codex-cli-provider.ts`）、核心镜像写入器（`packages/local-agent/src/mirror-step.ts`）、取消路径（`turn/interrupt`、有上限的收敛等待）以及 settled 上报。

## Testing

`tests/live-driver.spec.ts`：原来锁定「每条目一步」的行为用例，现在锁定「每调用一步」（基本轮次、逐次用量、流的合并与整次调用的 stream 跨度、先工具后回答的到达顺序、跨调用的预览等待、中止轮次的残留调用、无流轮次、续聊轮次）；新增一条用例锁定重复读数，包括调用中间的和跨轮带过来的。两条 codex live 镜像快照在单独的提交里更新：完成轮从 4 步变为 2 步（24 个事件变为 19 个），取消轮从 2 步变为 1 步（13 个变为 11 个）。codex 包测试数：之前 277，之后 278。另用真实 codex-cli 0.163.0 的 `app-server` 经驱动对接本地模拟 Responses 服务跑了一轮：之前 4 步，之后 2 步，每次调用用量只出现一次，第二次调用的思考和回答分别以 `1:2` 及其子项 `1:2:msg_1` 流式发布。

## Alternatives considered

**不用用量通知、只按 `item/started` 的先后分组。** 线上的条目不带调用 id；用量通知是 app-server 暴露的唯一调用分隔。

**边界一到就写出调用，即使还有未完成的条目。** 录到的流量里从未发生（工具输出在用量之前），而提前写出会在工具结果出现前关掉这一步；等待整次调用完成是 Claude live 的规则。

**下一次调用一开始就写出上一次，即使还有未完成的条目。** 这能限制卡住的条目拖住日志的时间，但会把工具和它的调用拆开；结算本来就会把剩下的全部写出。

**按 `last` 去重读数。** 两次不同的调用可能报出相同的逐次用量；线程总量只会随新请求增长。

## Consequences

Codex live 子日志现在每次模型调用一步，用量只出现一次，stream 记录覆盖整次调用；所以 Context Lens 的请求数不变（它本来就把这些步拼回去了），它的 `joinCall` 合并也不再需要处理 codex live（S8 会删掉它）。一次调用的消息在调用结束时写出，不再逐条目写；实时预览和 `local-agent/stream` 检查点照旧在流式过程中显示。代价：卡住的条目（开始了、一直没完成）会让它所在的调用以及之后的所有调用在轮次结算前都进不了日志；没有任何镜像块的调用（只有压缩或无法映射的条目）报出的用量不会写入；不带 item id 的增量仍然配不上任何条目（与以前相同）。
