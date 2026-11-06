# Agent Note: CLI 子智能体镜像成孙会话：核心写入模块

Status: implemented

## Problem

成员的 CLI 可以自己跑子智能体：Kimi 有 `Agent` 和 `AgentSwarm`，Claude Code 有 `Agent`（旧名 `Task`）。今天这些工作一点也进不了 dsh：成员会话里只是一行普通工具调用，宿主谱系下拉在成员下面什么也没有，子智能体的用量看不见。

已批准的设计 `proposals/active/2026-11-06-member-cli-subagents.md`（不在仓库里）把每个子智能体镜像成成员下面的一个孙会话。它的 M0 步已经落了词汇，见[核心类型那篇 note](2026-11-06-member-activity-core-types.zh.md)。本篇是 M2 步：Kimi（M3）和 Claude Code（M4）接入时共用的核心写入模块。

用户 2026-11-06 的决定里与本步相关的：

- 续用的 Kimi 子智能体算一个会话，每次续用是其中多一次执行、多一轮。
- 旧日志不回填。
- 工具结果截断规则与成员镜像相同。

## Decision

新模块 `packages/local-agent/src/cli-subagent.ts`，从包根导出。它只管写，不管发现：各家 provider 自己解析自己 CLI 的记录，再调它。

**会话。** `openCliSubagent(ctx, member, { provider, key, name?, description? })` 返回一个句柄。

- 会话 id 是确定的：`cliSubagentSessionId(member, key)` = `<成员子会话 id>.sub.<CLI 子智能体 id>`。重启后重放能找回同一个会话，不另存映射文件。
- 查找顺序是先活的、再存储的、最后新建。活的直接复用；存储了但已冷的经核心的 `ensureChildLive` 重新挂上（这一步也会补上重启时没关的轮）；都没有才新建。
- 新会话的会话头带宿主原生的父链接，和成员自己的子会话同样建法：`parentSession` 是成员子会话，`origin` 是 `'subagent'`，`delegationDepth` 是成员深度 + 1，`cwd` 同成员。
- 孙会话写一条 `subagent/descriptor`：one-shot、成员的委派 provider、label `<类型>: <描述>`。
- 成员会话写一条 `subagent/catalog`，内容与宿主 `establishCatalogChild` 写的完全相同：`{ version: 0, childId, childCreatedAt, mode: 'one-shot', label? }`。成员日志里已有这个孙会话的目录行就不再写。孙会话先于成员落盘，读者顺着目录行一定找得到会话。
- 孙会话的写入经过核心的子日志守卫，经核心缓存的写句柄落盘，与成员走同一条路。
- 同一个 key 的并发打开共用一次打开过程。这张「进行中」表放在 `globalThis` 上，因为每个 provider 的 bundle 都带一份本模块。

**执行。** `handle.beginExecution({ callId, memberExecutionId?, group?, background?, resumed?, transport?, admittedAt? })` 对应成员的一次调用。

- 它写一条 `local-agent/execution` start：caller 是 `cli`，operation 是 `prompt`，`callerRef` 是调用 id，`parentSessionId` 是成员子会话。
- 起因是 `{ kind: 'cli-subagent', sessionId, callId, executionId?, name?, group?, background?, resumed? }`。
- 成员那次执行按记录在案的事实找：先用显式给的 `memberExecutionId`；再用 `executionOfToolCall`，即轮次里含这次调用的那次执行；最后用成员当前开着的 prompt 执行，因为 live 镜像可能先写子智能体、后写成员自己的工具调用。成员那次执行的 `task` 原样照抄，所以按任务求和不用改就包含子智能体。
- 同一个调用 id 返回之前写过的那次执行，不写第二条 start，所以重放是幂等的。
- 新的调用 id 会先把孙会话日志里还开着的执行以 `uncertain` 结束。CLI 只续用空闲的子智能体，旧的那次不可能还在跑。

**写入。**

- `execution.mirror(unit, source)` 经 `appendMirrorStep` 把一次模型调用写成开着的那一轮的下一步；没有开着的轮就先开一轮。`beginTurn()` 和 `closeTurn(stopReason)` 留给自己切轮次的 provider；Kimi 每个 `turn.prompt` 一轮。
- `execution.end(outcome, { providerReportedUsage?, unrecorded?, endedAt?, errorMessage? })` 先关开着的轮：`done` 按完成关，`failed` 按出错关，`cancelled`/`uncertain` 按中止关。
- 然后写 end 记录。`turns` 取本次 start 之后、下一条 start 之前的 `turn/start`。`unrecorded` 照抄成员 harness 对这次调用传输方式的声明，调用方可以覆盖。`providerReportedUsage` 是 CLI 自报的这次合计，从不加进逐次用量。
- 写完 end 记录就落盘孙会话。结束之后的写入一律不做。

孙会话的 start 由本模块自己写，不经成员的轮次钩子（`beforeMirrorTurn`），因为孙会话没有核心自己接纳的执行。对没有登记钩子的会话，那个钩子本来也是空操作。

## Alternatives considered

**每次调用一个会话，Kimi 续用也拆开。** 用户决定不这样做。续用的 Kimi 子智能体上下文是累积的，拆开会让后几次看起来「凭空知道」前面的事。

**用调用 id 推出执行 id。** 随机 id 加上按 `cause.callId` 查找，幂等性一样。这样 start 记录的形状与其它执行完全一致，执行 id 也不绑任何一家 CLI 的调用 id 格式。

**按时间就近找成员执行。** 不采用，与批 5 各处一致。「开着的执行」这一兜底仍然是记录在案的事实：调用镜像时，它所在那轮的 start 还没有 end。

**从核心入口导入 `establishSubagentCatalogChild`/`persistChildSession`。** 这样会经 `index.ts` 形成循环引用，而 `index.ts` 有顶层 await，循环引用很脆。目录行内容内联，就是同样的六行，测试拿宿主的列表把它钉住。注册表经 `ctx.get('localAgent')` 按结构取用。

## Consequences

- 不新增事件类型：`subagent/catalog`、`subagent/descriptor`、`local-agent/execution` 都已登记。
- 目前还没有调用方，由 Kimi（M3）和 Claude Code（M4）接入。
- Context Lens 在 M7 之前仍只看一层（`store.ts`）。宿主谱系下拉已经能读到孙会话，因为它递归遍历目录行。
- 没有 local-agent 注册表时（测试里的裸宿主），模块照样在内存里写，只是不加守卫、不落盘。
- `openCliSubagent` 抛错（没有 sessions 服务、重新挂上失败）由 provider 负责降级。子智能体镜像缺失绝不能让成员这一轮失败。

## Testing

`packages/local-agent/tests/cli-subagent.spec.ts` 只用合成输入：一个假的家族 provider 经真实的核心接纳与共享镜像写入跑成员轮次。

- **每个 key 一个会话。** 并发打开共用一个句柄，之后的打开找到同一个会话。覆盖了：会话头链接（深度 2、父会话是成员）、一条 descriptor、一条目录行，目录行内容与宿主逐键相同；两边日志都已落盘。
- **每次调用一次执行。** 同一调用重复 begin 不写第二条 start。start 记录整条核对（caller、带成员执行与 group 的起因、照抄的 task、parent），end 记录也整条核对（turns、live 声明、CLI 合计）。各步经镜像写入器写，结束后的写入不生效，`subagentReadingsFor` 能在成员那次执行下读到它。
- **续用。** 在成员的下一轮里，同一会话多一次执行、多一轮（先 `[1]` 后 `[2]`），带 `resumed` 与 `background`，归属成员的第二次执行；目录行和 descriptor 仍各一条。
- **兜底。** 尚未镜像的调用归到成员开着的执行。在仍开着的执行上来了新调用时，旧的以 `uncertain` 结束，它开着的轮按中止关上。没有类型也没有描述时不写 label。
- **重启。** 在同一份存储上挂第二套栈：孙会话是重新挂上而不是新建，重放的调用拿回已存的执行 id。
- **宿主谱系。** 宿主真实的 `SubagentRuntime.listDescendants` 走通 房间 → 成员 → 子智能体，深度 2。
- 每个落盘用例里，孙会话日志都通过 `assertReleasedV4Relationships`，隔离区里什么也没有。
