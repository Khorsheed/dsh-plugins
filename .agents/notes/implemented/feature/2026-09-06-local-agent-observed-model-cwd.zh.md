# Agent Note: local-agent observed model readback and delegation cwd

Status: implemented

[English](2026-09-06-local-agent-observed-model-cwd.md) | 中文

## Problem

web-eval 冻结基线（决策 5）要求证明委派实际运行的模型与声明的一致，编排器（I2）还要给每格评测独立的目录。两者都做不到：四家 provider 的输出流里都有模型标识但没人记录（codex 的流里甚至完全没有——只有它落盘的 rollout 才有），而每轮 CLI 都跑在父会话 cwd 里、没有任何覆盖，四格做同一道题就共用一个目录，从重复样本变成了竞争者。

## Decision

- **观测通道。** registry 新增 `recordRoundSettled(childSessionId, { observedModel?, usage? })`：provider 在每轮输出解析完毕的 settle 点调用一次。它把 `observedModel` 合并进委派记录（内存与 `delegations.jsonl`，同样的 last-wins 追加），并上报新的 `LocalAgentRunProgress` 变体 `{ kind: 'settled', observedModel?, usage? }`。缺位字段保持缺位——记录的是缺位本身，绝不猜测。记录尚不存在的轮次仍上报事件；记录的其余部分不变。
- **读侧。** `delegationOf(childSessionId)` 返回不含 CLI 会话 resume 句柄的记录（`LocalAgentDelegationInfo`），编排器由此读每格的实测模型与首轮 cwd，而 resume 句柄继续只走一等参数加 intent 通道。
- **各家的来源，全部对真机 CLI 钉死。** claude：stream-json `system`（init）事件的 `model`（另折 `result` 事件以备未来 CLI）；codex：定位到的 rollout 文件里落在本轮 spawn 时间窗内的最后一条 `turn_context` 行——codex 0.144.0 的 exec --json 流事件不带 model，于是复用回收 usage 的那个 rollout 定位器同时回收模型，解析器仍折叠流内 `model` 字段以备未来 CLI；kimi：wire.jsonl `usage.record` 的 `model`（次选 `llm.request` 的），以最后一个为准；dsh：子会话自身的 `assistant/message` `message.source`，格式化为 `provider/model`，与 effectiveSettings 快照的形状一致。`observedModel` 绝不进入任何 prompt 或模型可见面。
- **cwd 覆盖。** `DelegationCallOptions.cwd` 搭载 staged 委派 intent（宿主 `SubagentStartRequest` seam 一行不改），经共享的 `resolveChildCwd(parentCwd, override)` 解析——这正是官方 ACP provider seam 预留的覆盖位。首轮解析出的 cwd 记进委派记录（`cwd` 字段）；resume 轮解析出的 cwd 与记录不一致时，共享的 `assertResumeCwdUnchanged` 在任何进程启动前 fail loud。两侧都缺省即父会话 cwd，与既有行为逐字节一致；没有 `cwd`/`observedModel` 的旧 `delegations.jsonl` 记录照常读入，并自动跳过该校验。
- 这是新能力，不是 T3 effective-settings 快照的延伸：T3 读的是「将会运行什么」（声明侧、条件哈希）；T11 记录的是「实际运行了什么」（观测侧、逐轮）。

## Alternatives considered

**用一次额外的 `codex exec` 探针或新起 CLI 进程读模型。** 拒绝：不额外 spawn 进程是家族不变量，而且 rollout 本就记录了当轮的模型——读被观测运行自己的产物，证据才始终绑定在该运行上。

**只记录首轮的观测模型、永不更新。** 拒绝：记录本就是 last-wins 语义，而 resume 轮自己的观测正是决策 5 逐轮校验所要的；settled 事件承载每一轮，记录承载最新一轮。

**让 `cwd` 走宿主 `SubagentStartRequest`。** 拒绝：harness seam 被「不改宿主」规则钉死，而 staged-intent 通道本来就是家族私有启动事实的通道——覆盖位与 resume 句柄走同一条路。

**per-call `cwd` 不落盘（拿父会话当前 cwd 做比较）。** 拒绝：重启或会话重挂后父会话 cwd 可能与首轮生效 cwd 不同；只有落盘的首轮锚点让「resume 在同一目录」成为可校验的事实而非假设。

**给 live 驱动也接上 `settled`。** 暂缓：评测驱动全 exec（冻结决策 2），live 驱动逐轮的 usage 记账因 wire 而异，live 模式下缺位是诚实的——exec 路径钉死契约，live 接线日后纯增量。

## Consequences

- 编排器可以逐轮比较声明模型与实测模型、漂移即 fail loud；每格的 CLI 在自己的目录里运行，格间互不干扰。
- `delegations.jsonl` 每次模型观测追加一行（与既有记录写入同属 replace-append 增长类）；记录仍是纯 JSON、无凭据。
- codex 的模型回读基于文件：轮次在 codex 写出 `turn_context` 之前被杀，本轮就没有模型可报——缺位依旧是诚实的答案。末尾被写断的 `turn_context` 行按同样的理由跳过。
- `settled` 事件里 kimi 的轮次 usage 是互不重叠的镜像窗口（live 轮询加 settle 一趟）之和，与子会话的 exactly-once token 记账一致。
- provider 对 `recordRoundSettled` 与其他核心方法一样硬调：core 与 provider 作为同一条家族线发布；先于该方法的 npm 混装组合会 fail loud，而不是静默跳过合并。
