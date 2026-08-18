# Agent Note: local-agent 公开委派门面（start / resume / cancel）与 reattach 配方

Status: implemented

[English](2026-08-18-local-agent-delegation-facade.md) | 中文

## Problem

代表用户行事的插件（提案中的 room、未来的编排器）此前没有受支持的途径委派给本地 coding-agent CLI：家族的委派协议——按 (parent, provider) 的 intent FIFO、resume 锁、经归属校验的委派记录——只能通过重新实现模型工具的内部逻辑来触达，而朴素的重新实现会重新打开孤儿 intent 窗口（`ctx.subagents.start()` 在 provider 消费前抛错时残留在 FIFO 里的 intent 会被下一次同名 (parent, provider) 的 start 误消费）。跨重启续跑还有第二个缺口：进程内卸载后 dsh 子会话不在场，家族 provider 对此 fail loud。本 note 是[委派 API 提案](../../../proposals/active/2026-08-18-local-agent-delegation-api.md)的 M1 里程碑。

## Decision

`LocalAgentRegistry`（`ctx.localAgent`）在 `packages/local-agent/src/index.ts` 长出公开门面：

- `start(parentSessionId, provider, prompt, opts?)` / `resume(parentSessionId, provider, childSessionId, prompt, opts?)`——一次调用完成 provider 存在性预检、（仅 resume）原样复用的 `resolveDelegation` 归属校验与新增的只读 `isResumeLocked` 探针、经 `ctx.agents.get` 的 live 父会话解析、下述 reattach 配方，随后 stage 恰好一个 intent 并在同一同步执行流内 `await ctx.subagents.start()`。start 失败经新增的 `unstageDelegationIntent`（按引用移除指定 intent 对象；provider 已消费则为 no-op）回滚——为门面调用方堵上孤儿 intent 窗口。
- `cancel(childSessionId)` abort 每个 in-flight run 登记的自建 `AbortController`（经 `AbortSignal.any`——harness 自用的融合原语——与调用方的 `opts.signal` 融合）；登记项在 `run.result` 任意 settle 时自行清除。未命中返回 `false`。
- `DelegationCallOptions`（`{ label?, signal? }`）刻意保持可加性——`onProgress`/`reattach` 随后续里程碑落地。
- registry 不新增硬 inject：`subagents` / `agents` / `sessions` / `sessionPersistence` 均在调用时经 `ctx.get` 惰性读取，门面调用需要的服务缺席时抛出指明服务名的错误（核心 degrade-don't-explode，调用 fail-loud）。

**Reattach 配方**（固化在 `resume` 的 doc comment 中供 room 直接引用）：`ctx.sessions.get(childSessionId)` 为 undefined 时，`using prep = await ctx.sessionPersistence.prepare(SessionId(childSessionId))`，随后 `ctx.sessions.enter(prep.session)`，detach disposer 由 registry 持有至插件卸载。发布**只 enter、不 `sessions.announce()`**：`enter` 安装 append 发布钩子并加入 store——provider 的 liveness 探针与 transcript 镜像的 `session/event` 广播所需的全部——而 `announce` 只发 `session/created`，其语义是新会话创建。持久化的子会话在其原始生命周期已发过 `session/created`（fresh 委派经 `sessions.create()` 发布），重发会让创建类监听器（apiproxy 投影、按会话的 setup 不变量）把一个正在恢复的会话当成新建。官方 `agentLoop.resume` 的 publish 路径之所以 announce，是因为它为本进程生命周期发布的是全新的 live agent+session 对；CLI provider 的子会话是没有 agent 在其上运行的纯 transcript 容器。

## Alternatives considered

- **`enter` + `announce`（镜像 `agentLoop.resume` 的 publish）**——否决：`announce` 存在的意义是发 `session/created`，对已创建过的身份重发创建事件会让创建类监听器在恢复路径上再跑一遍；resume 路径上没有任何消费方需要该事件。
- **对不在场子会话用重型 `ctx.agentLoop.resume()`**——否决（提案「现状」一节）：它会拉起完整 agent 循环，对无 agent 驱动的 transcript 容器型子会话是错的工具。
- **为 `cancel()` + `opts.signal` 手写 abort 信号扇出**——否决：`AbortSignal.any` 是 harness 自用的原语（agent-loop 的 resume），一行搞定且无监听器簿记。
- **核心硬 `inject` `subagents`/`agents`/`sessionPersistence`**——否决：核心必须能独立安装运行（AGENTS.md）；惰性 `ctx.get` 让仅记录+登录的组合行为逐字不变，门面调用则 fail loud 指明缺失服务。

## Consequences

- room 等插件一次调用即可完成委派、续跑与取消，无需触碰 intent FIFO；resume 句柄仍不进 prompt 文本，三条家族不变量（归属校验、恰好一次配对、每子会话一个 in-flight resume）保持——归属校验对插件调用方是防误用而非防恶意（同进程互信），doc comment 已写明。
- `unstageDelegationIntent` 同时修复了任何采用它的调用方的既有孤儿 intent 窗口；模型工具路径刻意不动（行为逐字不变）——其窗口待日后改走门面时关闭。
- 进程内被卸载的子会话可经 reattach 配方续跑；**跨重启 resume 仍不可用**，直到 M4 持久化委派映射（重启后 `resolveDelegation` 必然 miss）——里程碑边界是有意为之。
- `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-subagent` 进入核心的 peerDependencies（门面公开类型所需）；缺席时的运行时加载不受影响——相关 import 均为 type-only。

## Testing

`packages/local-agent/tests/delegation-facade.spec.ts`（15 个测试）挂载真实 SessionStore/CommandRuntime/AgentRegistry，配假 `subagents` provider（记录 intent 消费）与经真实 store 重建会话的假 `sessionPersistence.prepare`：fresh start 配对 + run 登记 + settle 清理、有无 reattach 的 resume、插件卸载时 reattach 释放、全部 fail-fast 路径不 stage、孤儿回滚两条支路、cancel 命中/未命中与调用方信号传播。`pnpm --filter @khorsheed/dsh-local-agent test`（89 个测试）与 `pnpm --filter @khorsheed/dsh-local-agent-tool-subagent test`（10 个测试）保持全绿，工具包零改动。

## Cross-references

- [委派 API 提案](../../../proposals/active/2026-08-18-local-agent-delegation-api.md)——本 note 实现的里程碑计划（M1）。
- [CLI 子代理 resume](2026-08-16-local-agent-resume.md)——门面封装的工具侧 resume 机制。
- [dsh 子代理会话镜像](2026-08-18-local-agent-dsh-session-mirror.md)——reattach 后的子会话接收的 transcript 镜像。
