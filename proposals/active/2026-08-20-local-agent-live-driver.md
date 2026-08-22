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
- 协作分工（2026-08-22）：本提案由独立 agent 推进，member-state 提案由 local-agent 家族线（本会话）推进，互为验收方；共享契约是共享折叠层（member-state 的翻译规则挂在这里，本提案改它的传输），折叠层接口变更需双方确认；排期按 provider 打包（落地某家时该家的任务翻译 spike 邻近安排）。
- **M1 落地（2026-08-22,worktree `dsh-plugins-wt-live-driver`,待合并验收）**:dsh 长驻驱动。通道选型：官方 SDK JSON-RPC wire 无 turn 级 interrupt（登记为上游接缝 S8),故 headless bundle 新增 `--serve` 常驻模式（自家 wire,同官方帧格式）+ 进程内 `Agent.cancel`;provider 侧 `DshLiveDriver`（每成员一个常驻 runtime、空闲回收、崩溃重连续跑、握手失败永久回退 exec）;镜像传输侧新增 `mirrorDshLiveEvent`（折叠层既有接口未动，文件镜像留作 settle 对账）;token 粒度为 opt-in(`liveMirrorGranularity`)。详见 Agent Note `implemented/feature/2026-08-22-local-agent-dsh-live-driver.md`。
- **M1 验收修复（2026-08-22,commit `7ce9a8a`,验收通过）**：慢窗口取消（B1）与 stop-改口错杀（B2）根治——wire 通知带父侧轮次号（turn 标签）,abort 监听器挂在一切 await 之前；S1–S6 生命周期/wire 卫生同轮修。
- **M2 落地（2026-08-22，同 worktree，待验收）**:codex 长驻驱动。通道 = `codex app-server --stdio`（协议经 `generate-json-schema` 机械探针确认：`thread/start`(ephemeral:false 持久化）/`thread/resume`/`turn/start`/`turn/interrupt`/`turn/completed`/`item/completed`/delta 通知/审批请求）;每成员一进程（成员桥 `-c` 覆盖与 scoped CODEX_HOME 钉住单成员）;app-server item → `CodexTranscriptLine` 传输侧映射，折叠核与留置规则与 exec 逐字共享；审批无人值守自动应答；轮关联按服务端 turn id(M1 的轮次号标签的 codex 形态）。真实 CLI 冒烟过（握手/线程/turn/interrupt/interrupted 关轮/EOF 退出 0)。详见 Agent Note `implemented/feature/2026-08-22-local-agent-codex-live-driver.md`。
- **M1（dsh 长驻驱动）验收记录（2026-08-22，验收方：member-state 线）**：交付 commit `ac8118a`（worktree `dsh-plugins-wt-live-driver`）。通过项：折叠层契约（`mirrorDshLiveEvent` 与文件镜像共享过滤与 append 核，offset/skip 核算不受 chunk 粒度干扰）；seam registry S8 登记规范；headless 33/33、local-agent-dsh 54/54；验收方独立冒烟（真实模型 + 真实凭证）：握手、fresh turn、**运行中 interrupt 后进程存活**、resume 续轮、shutdown 干净退出全过；serve 的降级路径（无桥接 env 时 fail-open）在真实 boot 中验证。**结论：不予通过，打回修复**——对抗性审查发现两个 blocker：B1 cancel 在 spawn/握手/accept 窗口内被静默丢弃（abort 监听器在 ensureRuntime 与 accept 之后才挂载，`live-driver.ts:377/448`，而这恰是 graceful cancel 最重要的慢窗口）；B2 `session/idle` 无 turn 关联且 `onIdle` 单槽不在 settle 时清除，stop→改口 的连发场景下 round 1 的 unwind idle 会错误 settle round 2（`live-driver.ts:419-423` + `serve.ts:121-144`）。follow-up 梯队：S1 disposeAll 与进行中 spawn 竞态、S2 同 key 双 spawn 无互斥、S3 畸形 notification 可使父进程崩溃、S4 UTF-8 跨块截断静默损坏、S5 通道熔断粒度过粗、S6 accept 失败留 dangling turn/start 使镜像永久失配。修复后重报验收；冒烟脚本留在 worktree `scratch-serve-smoke.mjs` 可复用。
- **M1 复验（2026-08-22，验收方：member-state 线）：通过。** 修复 commit `a747cc5`。B1：abort 监听器挂在一切 await 之前、握手与信号赛跑、accept 窗口内取消照发 interrupt、呼叫方取消不触熔断——代码与单测双确认；B2：wire 轮次标签（turn 回显）+ 处理器按标签过滤 + settle 清除 + turn 边界改为 ack 后开（缓冲事件边界内回放）——代码与单测双确认，stop→改口场景钉住；S1–S6 逐项修复有测试。验收方复跑真实模型冒烟（更新脚本至带 turn 标签的新契约）：fresh turn → 运行中 interrupt 进程存活 → resume 续轮 → shutdown 退出 0，全过。家族回归：headless 33/33、local-agent-dsh 63/63。随后由验收方协调合入 main。
- **M2（codex app-server 长驻驱动）验收记录（2026-08-22，验收方：member-state 线）：通过。** 交付 commit 见 git 历史（worktree `dsh-plugins-wt-live-driver`，分支 `feat/local-agent-live-driver`）。指名审点 `codexAppServerItemToLine`：与 exec 折叠（`foldCodexStreamLine`）逐项核对——think/text/tool 行形态一致、usage 语义逐字相同（input−cached / cacheRead=cached）、末行留置到 turn/completed 挂用量的规则一致、ack 后开边界 + 早期通知缓冲回放的 M1 纪律已延续；微小差异（live 覆盖 mcpToolCall、仅 output 的 commandExecution 带 detail）均为增量而非漂移。协议探针先行（`generate-json-schema` 机械导出）的做法符合提案要求。验收方独立冒烟（真实 codex 账号、scoped home）：initialize → thread/start → **完整 turn 跑完（status=completed，作者冒烟未覆盖的一腿）** → `thread/tokenUsage/updated` 到达 → 同一线程第二轮完成 → EOF 退出 0。单测 49/49、构建绿。M1 验收纪律（取消全窗口、崩溃重连、空闲回收、spawn 去重、冷却熔断）经代码抽查确认已预置。随后由验收方协调合入 main。

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
