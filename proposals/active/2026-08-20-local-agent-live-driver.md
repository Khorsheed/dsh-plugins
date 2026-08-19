# local-agent provider 长驻驱动模式（live driver）（local-agent-live-driver）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-20
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）。`local-agent-delegation-api` 仅在论证「跨重启断点与 wire 协议无关」时提及 app-server，非同一意图；已废弃的 codex note（rejected/2026-08-17）不含此项。无重复，新建。
- **官方依赖**：纯插件。所有长驻通道均为各家 CLI 自有能力（`codex app-server`、`kimi acp`、claude Agent SDK、dsh 子实例 API），harness 侧的 `subagent-codex`（app-server wire）与 `subagent-acp` 仅作参照实现阅读，不改动。零 harness 改动。

## 目标

给家族 CLI provider 增加**第二种驱动模式**：成员以长驻 runtime 会话「活在」dsh 上，一轮委派 = 向活着的 runtime 发一个 turn，而不是每轮 spawn 一次性 CLI 进程。换回四样东西：

1. **优雅中断**：runtime 级 cancel（turn/interrupt）替换进程级 SIGTERM/SIGKILL；
2. **运行中干预**：mid-run steer / 补充输入成为可能（当前模型下物理不可能）；
3. **审批中继**：运行时的权限请求（app-server/ACP `session/request_permission`、SDK `canUseTool`）有了上报通道，为「成员边干边请示人」留口；
4. **低成本流式**：事件由 runtime 以 notification 主动推送（推模式），替换现行的轮询/整体解析 transcript（拉模式）；token 级流式退化为「把 delta 写成 `assistant/chunk`」，同时省掉轮询与重复解析两份开销。

非目标：不删除 exec 驱动（静止零成本、故障面小，保留为 fallback 与无长驻能力环境的默认）；不追求官方 continuable 语义接入（harness 的 Activation 契约不覆盖外部运行时，编排层仍是自家 facade——见 member-channel 提案 §0）；不改变 facade / 委派记录 / 归属校验 / 成员通道的任何对外契约。

## 现状（已核实）

- **通道能力**：kimi 有 `kimi acp`（ACP over stdio）；codex 有 `app-server`（标注 experimental）；claude 有 Agent SDK（streaming input 模式，进程内多轮 + interrupt）；dsh 子实例是完整 dsh，可常驻后走自身 API。
- **参照实现**：`~/code/deepseek-harness/packages/subagent/subagent-codex`（驱动 `codex app-server --stdio`）、`subagent-acp`（通用 ACP provider）可读不可依赖——它们运行在父会话 workspace、用用户原生凭证，不做 scoped home 与委派簿记，不能直接挂载替代家族 provider。
- **家族现状全部是传输无关设计**：facade（start/resume/cancel）、delegations.jsonl、resume 锁、reattach、gateway、成员 composer/桥接均不感知 provider 内部如何驱动 CLI；`cliSessionId` 记录的就是 thread/session id，长驻模式原样使用。M3 的增量镜像是当前唯一的拉模式残留。
- **外部印证**：Agents-Anywhere 的 connector 用同一模型（SDK 长连接 / app-server / ACP 附着长驻 runtime），其复杂度集中在生命周期管理（zombie 回收、重连、版本探活），印证了本提案的主要成本所在。

## 方案

### 1. 驱动抽象（各 provider 内部）

provider 内部抽象出 driver 接口（大致 `ensureLive(member) → handle`、`sendTurn(handle, prompt)`、`interrupt(handle)`、`events(handle) → AsyncIterable`），现有 exec 路径作为 `execDriver` 原样保留；新增 `liveDriver`。`ctx.subagents.start()` 的入口分流：配置启用 live 且通道可用 → liveDriver；否则 execDriver。resume 锁、intent 消费、recordDelegation 的调用点不变。

### 2. 生命周期管理（本提案的主要成本）

- 粒度：**每成员（child session）一个 runtime 连接**，进程可按 harness 共享（codex app-server 一个进程管多个 thread；kimi acp 一进程一会话——逐家按协议能力定）。
- 拉起：成员首轮委派时；崩溃/断连：thread/session id 在盘上，重连后 resume 同一线程（复用 M4 的持久化记录）。
- 回收：空闲超时（可配，默认如 30 分钟）+ 插件卸载时全部回收；所有进程登记在册，绝不留僵尸（对照 Agents-Anywhere 的教训）。
- prod 环境注意：长驻进程处于 ankh-guard 监管下，启动/回收纪律要写进实现 note。

### 3. 事件流与镜像

live 模式下镜像改为事件驱动：runtime notification → 直接折成子会话事件（`assistant/chunk` 或攒块为 `assistant/message`，粒度由 provider config `liveMirrorGranularity: 'event' | 'token'` 控制，默认 event）。exec 模式的 M3 拉模式镜像原样保留。两条路径共享同一套折叠/usage 簿记，offset 语义不变。

### 4. 中断与 steer

- `cancel(childSessionId)`：live 模式下发 runtime cancel（graceful），exec 模式维持现状。facade 签名不变，内部按该成员的驱动分发。
- steer（运行中补充输入）：live 模式 expose 为后续增量（成员通道的 composer 可以加「追问正在运行的成员」），本提案只要求 driver 接口不挡这条路，不实现 UI。

### 5. 审批中继（留口不实现）

driver 接口预留 `onPermissionRequest` 钩子；接到后的呈现（房间待确认卡 / composer 内联审批）属 room 或后续提案。本提案只保证权限请求不被静默吞掉：默认策略 = 按 spawn 时的权限模式自动应答（与 exec 模式行为一致）。

### 6. 逐家落地顺序与方式

| 里程碑 | provider | 通道 | 参照 |
|---|---|---|---|
| M1 | dsh | 子实例常驻 + 官方 API | 自家机制，最顺 |
| M2 | codex | `codex app-server` JSON-RPC | harness `subagent-codex` |
| M3 | kimi | `kimi acp` | harness `subagent-acp` |
| M4 | claude | Agent SDK streaming input | SDK 文档 |

每家独立交付、独立 commit、独立可回退（配置开关关掉即回 exec）。

## 实现记录

- 动机讨论：与 Agents-Anywhere connector 模型的对比评估（2026-08-19，结论是「他们的复杂度在生命周期管理，我们的优势在静止零成本与 scoped 隔离，混合驱动取两边」）。
- 前置：delegation-api 提案 M1–M4（facade/持久化/锁/reattach）、member-channel 提案（成员 composer/桥接）——本提案对它们是透明的。

## 验收标准（done 判定，绑定可插拔交付）

- 每个落地 provider：live 模式下 fresh + resume 委派全链路绿（含跨重启：进程回收后凭 thread/session id 重连续跑）；`cancel` 为 runtime 级优雅中断（进程不死，可续）；事件驱动镜像与 exec 模式镜像的最终子会话 transcript 一致。
- 开关：配置关闭 live 驱动后行为与现状逐字一致（exec 路径回归全绿）。
- 生命周期：空闲回收生效；强杀 runtime 进程后下一次委派自动重连恢复；profile 重启无僵尸进程残留。
- 隔离性：未启用 live 的用户零感知；各 provider 互不被阻塞。
- 流式：live + token 粒度下，成员会话在 run 进行中呈 token 级增长（claude/dsh 至少一家实测）。

## 风险 / 放弃的东西

- **协议漂移**：codex app-server 标注 experimental，ACP 各端实现成熟度不一——每家落地时先跑机制探针（对照 2026-08-19 的 claude/codex spike 方法）再写实现；协议升级导致的不兼容以 provider 测试钉住。
- **生命周期是新故障面**：长驻进程引入 zombie/泄漏/状态漂移风险，exec 模式时代这些不存在——接受，因为换来的是中断/steer/流式；回收纪律与僵尸检测必须随首个落地（M1）一起交付，不留到后面。
- **token 粒度的写放大**：每条 delta 一次 append + 持久化 + 广播——默认 event 粒度，token 仅作 opt-in。
- **明确放弃**：官方 continuable 语义（仍需上游 Activation 契约）；删除 exec 驱动（永久保留）；审批 UI（只留钩子）。
