# Agent Note: 委派子会话在工具路径上可 reattach，并显式持久化

Status: implemented

## Problem

一个生产评审会话（session-e19a1be9，宿主 19:14 被看门狗重启）暴露了委派 CLI 子会话上两个独立的持久化缺陷——叠在 [step 边界 note](2026-09-12-local-agent-mirror-step-boundaries.md) 修复的实时渲染缺口之上：

1. **重启后 resume 报 "not live"。** 宿主重启清空内存里的会话注册表。facade 的 `resume` 会从持久化 reattach，但家族的 subagent 工具（`subagent_codex` 等）直接经 `ctx.subagents.start` 发起运行——代码注释自己这么写——于是 reattach 从未执行，provider 拒绝了 resume。
2. **子会话日志永远停在 header。** 生产实例上每个委派子会话日志（检查了六个，重启前后都有）都只有一行 header。宿主只在**写 handle 打开期间**把 live `session/event` 路由进 per-id writer，并在 `session/flush` checkpoint 时 drain；镜像会话没有 agent loop，没有任何东西替它触发 checkpoint。各 provider 的 `persistIfStandalone` 以"live session 自己的 write-behind 会落盘"为由跳过 live 会话——这个假设在宿主 0.1.5/master 上对无 loop 的镜像会话不成立。用户实时看到的内容从未写进磁盘。
3. **所有 CLI 失败都只有一句 "subagent run failed"。** seam 本来用 `SubagentResult.diagnostic` 承载 provider 的失败细节，但 codex provider 从没提供过，工具的错误映射又把字段丢了——一次 codex 端点瞬断（rollout 里三次 exit 0、`last_agent_message: null`）和真实缺陷完全无法区分。

## Decision

- **工具路径 reattach。** registry 暴露 `ensureChildLive(childSessionId)`——facade resume reattach 配方的公开幂等入口——subagent 工具在 stage resume intent 之前调用它（对旧 core duck-type 降级）。
- **每个子会话一个 registry 持有的写 handle。** `LocalAgentRegistry` 用 `childWriteHandles` promise 缓存做唯一 owner；reattach 配方重构到同一缓存上（第二次 open 会撞 `SessionAlreadyOwnedError`），全部 handle 随插件 dispose 关闭。`syncChildSession(session)` 经缓存同步：读已存前缀、只补缺失后缀（重复调用与"write-behind 真的工作"两种情况下都幂等）、flush；任何失败降级为 warn——持久化绝不能炸掉轮次。providers 在每次镜像 pass 后调 core 的 `persistChildSession(ctx, session)` 取代各自的 `persistIfStandalone`，并删掉委派起点直接创建（并泄漏）persistence handle 的代码。standalone fallback 保留一次性 handle 流程但去掉 live-skip：先读已存前缀，在 write-behind 生效的地方 suffix 自然为空。
- **诊断沿 seam 传递。** codex provider 向 `settleRunResult` 传 `collectDiagnostic`——失败本身的消息、stderr 尾部、以及 rollout 路径（`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`，未流到 thread id 时给目录）——家族工具渲染为 `subagent run failed: <diagnostic>` 取代笼统的一句。

## Alternatives considered

- **等上游为无 loop 会话做 write-behind**——flush/checkpoint 架构是宿主的刻意设计（checkpoint policy 拥有持久化时机）；镜像会话是插件侧概念，持久化就该插件自己负责。suffix sync 今天在每条宿主线上都有效。
- **总是手动持久化（不用 registry 缓存）**——每次调用 `open('write')` 会撞 reattach 持有的 handle（`SessionAlreadyOwnedError`），也会在并发镜像 pass 下撞自己；单一 owner 缓存是 sync 安全的前提。
- **保持笼统报错 / rollout 路径只进宿主日志**——需要做"重试还是换 provider"决策的消费者是 agent（不是翻日志的人）；diagnostic 字段就是为这个设的，工具只是把它丢了。
- ** retro 恢复丢失的转写**——不可能：事件从未写在任何地方。CLI 侧 rollout 还在（codex 自己的文件），所以 CLI 线程 resume 仍然可用；dsh 侧子会话日志只是从下一轮开始。

## Consequences

- 重启后从每个入口（facade、工具、member composer）resume 委派子会话都可用。修复前的子会话 dsh 侧日志从空开始（事件从未写入）；CLI 线程本身完好，会话连续性不受影响。
- 子会话日志随轮次增长——刷新后子会话视图可见，resume-reattach 恢复的是真实历史而不是空壳。
- 一个可观察的行为变化：kimi/claude/dsh 的 live 轮次现在在运行**进行中**就落盘（旧代码对 live 会话整体跳过），不再只在 settle 后。
- 错误结果点名失败原因并指向 rollout 文件；不看宿主日志也能区分 CLI 瞬时空完成与真实缺陷。
- 双重写入竞态（未来宿主修好 write-behind 后与 sync 并发 drain）最坏是 warn + 下次 sync 自愈，不会损坏：stored 前缀覆盖后 suffix 为空。

## Testing

`child-session-sync.spec.ts`（core）：live sync 落盘、重复 sync 无重复 append、reattach 与 sync 共用一个 handle（不撞 already-owned）、失败 warn 并重试。工具 spec：resume 前执行 reattach 配方（断言 open + enter）、provider diagnostic 透到错误文本。codex provider spec：settle diagnostic 点名退出码与 rollout 目录。家族全套件绿（local-agent 230、tool-subagent 17、codex 166、kimi 186、claude-code 153、dsh 147）。

## Related

- [Local-agent 子会话镜像补写 step 边界](2026-09-12-local-agent-mirror-step-boundaries.md)——同一事故的实时渲染半边。
