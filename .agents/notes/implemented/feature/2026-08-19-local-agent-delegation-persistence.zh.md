# Agent Note: local-agent 委派映射持久化（delegations.jsonl）

Status: implemented

[English](2026-08-19-local-agent-delegation-persistence.md) | 中文

## Problem

`LocalAgentRegistry` 的委派映射（`childSessionId → { provider, parentSessionId, cliSessionId, kimiMirroredLines? }`）与 kimi 镜像 offset 此前只存在内存 Map 里，宿主重启即丢——上一轮留下的 resume 句柄在 `resolveDelegation` 处即以「no delegation recorded」失败，跨重启续跑链路由此断裂。本 note 是[委派 API 提案](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md)的 M4 里程碑；存储设计逐字吸收自已废弃的 [codex 持久化 note](../../rejected/feature/2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md) 第 1 条（该 note 废弃时并入提案 M4）。

## Decision

在每个 harness 的作用域目录下放 append-only 的 `delegations.jsonl`（`registry.homeDir(name)/delegations.jsonl`——harness 级簿记，与 session_index/rollout 文件同域，不放子会话日志）：

- **写路径**：`recordDelegation` 在更新内存 Map 后以 `appendFileSync` 同步追加一行 JSON——记录每 fresh 轮 settle 只发生一次，持久性优先于异步花哨。所属 harness 经已注册 harness 的 `delegationProvider` 字段解析；无认领 harness 的 provider 保留内存记录并 warn，绝不抛错（记录不得打断一个正在 settle 的 run）。`setKimiMirroredLines` 推进 offset 时带最新 `kimiMirroredLines` 重追加该记录，offset 随记录跨重启存活。
- **读路径**：`register(harness)` 在发出 `localAgent/harness-added` 之前同步把该 harness 的文件读入 `delegations` 与 `kimiMirrorOffsets`。同一 childSessionId 最后一行生效——与 `recordDelegation` 的替换语义一致。格式错误的行、以及 provider 与加载 harness 不符的行，跳过并 warn，绝不让注册失败。
- **`resolveDelegation` 逐字不动**：同步签名不变，归属校验（父会话、provider）对恢复的记录与对存活记录一视同仁。
- 增长被接受（append-only、无轮转）——与 session_index/rollout 同级增长——并写进包 README 的 Known Limitations。

配合 M1 的 reattach 配方，跨重启链路闭合：映射在 `register` 时加载 → `resolveDelegation` 通过 → 门面从持久层 reattach 子会话 → provider 续跑 CLI 线程 → kimi 镜像从持久化的 offset 续走（不重复镜像首轮）。

## Alternatives considered

- **映射存进子会话日志**——否决（沿用已废弃 codex note 的取舍）：映射是 harness 级簿记（「哪个 dsh 子会话续哪条 CLI 线程」），子会话日志属 dsh 会话域，其生命周期（重开、清理、compaction）归会话系统所有；存作用域目录让两个域各自演进。
- **内存 Map + 异步/批量写**——否决：写入每委派轮只发生一次；同步追加更简单，也消除了 settle 与 flush 之间的丢写窗口。
- **整文件重写当前 Map 状态而非 append-only**——否决：append-only 与 harness 其他 journal 文件一致，无需处理并发 registry 操作的读改写竞态，且「最后一行生效」免费给出替换语义。
- **`resolveDelegation` miss 时惰性加载**——否决：那会迫使（同步、契约钉死的）归属校验变异步或在其内部藏 I/O；在 `register` 时加载让所有读路径保持同步。

## Consequences

- 委派的 resume 句柄跨宿主重启存活，跨重启链路的最后一个断点闭合（M1 reattach + M4 映射）；`kimiMirroredLines` 重启后不再回退到 0，续跑轮绝不重复镜像早期内容。
- 每次 `recordDelegation` 现在做一次同步文件追加——每 fresh 轮 settle 一次（有记录时每次镜像 pass 再追加一次）；settle 路径上的 provider 功能上无感。
- 无 harness 认领的 provider 的记录只留内存并 warn——日志可见、绝不致命；文件的持久性以认领它的 harness 注册为准。
- offset 独立性不变量保持：`kimiMirrorOffsets` 运行时仍是独立 Map（无记录时 offset 照常推进）；持久化只是在没有记录时没有 offset 可恢复——而那正是 resume 本就不可能的情形。
- 长存 profile 下文件无界增长（接受；轮转留待后续——见包 README）。

## Testing

`packages/local-agent/tests/delegation-persistence.spec.ts`（6 个测试）以共享 homesRoot 挂载全新 registry 模拟重启：记录 → 重启 → 解析且归属校验不变（错误 parent / 错误 provider / 未知 child 仍被拒）、跨重启替换语义（后行生效、内存单条）、损坏行与外来 provider 行跳过而合法同文件行照常加载、无认领 provider（内存保留、不抛错、不落盘）、offset 持久化（`setKimiMirroredLines` 推进可恢复）。warn 文本本身不断言——cordis 内建 logger 在测试中不可拦截（每次 `ctx.logger` 访问都是新实例）；测试钉住的是跳过/不抛错/不落盘的行为。回归：local-agent 101/101、kimi 56/56、tool-subagent 10/10。

## Cross-references

- [委派 API 提案](../../../proposals/closed/2026-08-18-local-agent-delegation-api.md)——本 note 完成的里程碑计划（M4，设计见 §2）。
- [已废弃的 codex 持久化 note](../../rejected/feature/2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md)——所吸收存储设计的出处（第 1 条）。
- [委派门面](2026-08-18-local-agent-delegation-facade.md)——本 note 补齐其 reattach 配方的 M1 门面。
- [实时 transcript 镜像](2026-08-19-local-agent-live-mirror.md)——本 note 持久化其 offset 的 M3 镜像。
