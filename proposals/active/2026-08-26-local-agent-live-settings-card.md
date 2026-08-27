# local-agent 设置卡片（认证 + 常驻模式进设置页插件卡片）（local-agent-live-settings-card）

- **分类**：plugin
- **状态**：in-progress
- **最后更新**：2026-08-27
- **查重结果**：已搜 `proposals/active/`（member-state、member-channel、delegation-api、mode-switcher、plugin-manager 等，均非同一意图）与 `proposals/closed/`（live-driver——本提案是它的配置面后续，不重复立项）。无重复，新建。
- **官方依赖**：纯插件。设置卡片走官方 `settings.plugin.item` keyed 槽（`ui-settings-plugins` 声明，专为仓外插件设计）；设置数据走官方 `settingsNamespace()` / `settingsScope.bind`（revision-fenced 写 + 镜像订阅）。零 harness 改动。

需求来源：live-driver（四家全部落地后）常驻模式的开关目前是 Cordis loader config（YAML），改动要插件重载/重启才生效，普通用户碰不到。官方设置页的 Plugins → 可配置插件 tab 已有成熟先例（ui-shortcuts 的快捷键卡片、context-guard 的压缩提醒时机卡片），把 live 开关迁进去，让「是否常驻」成为用户可感知、可热切的偏好。同时把现有「本地 Agent」设置 section 的认证管理（登录/登出/状态）按 provider 拆进各自卡片——家族在设置页只留一个家（Plugins tab），不再多占一个 tab。

## 目标

1. **每个 provider 一张设置卡片**：注册 `settings.plugin.item`（key = 各 provider 的 settings 命名空间），出现在官方 Plugins → 可配置插件 tab，与快捷键、压缩提醒时机同款形态。卡片承载两块：**认证**（状态、登录/重新授权/登出、device-code 提示、OAuth 码粘贴）+ **常驻模式**（live 开关、输出粒度、差异提示）。
2. **热切生效**：live 开关与输出粒度改动**不重启、不重载插件**——下一轮委派即按新值走；进行中的 run 不被打断。
3. **可理解的差异提示**：卡片内用一两句话讲清常驻模式与 exec 模式的差别（流式、取消语义、崩溃恢复），用户知道自己在开什么。
4. **retire 独立 section**：四家卡片落地后撤掉 core 贡献的 `settings.section`「本地 Agent」tab 及其子槽（`local-agent.settings.row` / `row-action`），设置页不再多一个 tab。

非目标：搬迁其他配置（`homesRoot`、`proxyUrl`、`baseUrl`、`liveIdleMs` 等留 YAML，属部署级/高级项）；room 专属视图（room 侧不需要任何改动）。

## 现状（已核实，2026-08-26）

- **live 配置是每 provider 一份的 Cordis config**：四个包各自的 `src/index.ts` 声明同构 schema（`live` default `false`、`liveIdleMs` default 30min、`liveMirrorGranularity` default `'event'`），driver 在 `apply()` 时按 `config.live === true` 一次性构造（kimi `index.ts:116-121`，codex `:82-87`，claude-code `:104-111`，dsh `:133`）。改 YAML 必须重载才生效。
- **热切先例已存在**：local-agent-dsh 有 settings 命名空间 `local-agent-dsh`（schema 现仅 `{ enabled }`），用 generation+sync 把设置值实时镜像成注册/注销，无需重启（host `local-agent-dsh/src/index.ts:101-136`，client toggle `local-agent-dsh/src/client/index.ts:42-51`）。本提案把同一模式扩到四家的 live 配置上。
- **卡片先例已存在**：context-guard（`settings.plugin.item`，key = 命名空间，`context-guard/src/client/index.ts:105-112`）与 ui-shortcuts（`ui-shortcuts/src/client/index.ts:222`）都是逐字可抄的接入样板；宿主无声明式 schema→表单，卡片 UI 手绘 React，schema 只负责校验与默认值。
- **设置是全局的**：settings 命名空间不按会话隔离，切换影响所有后续委派（in-flight 不打断，见 §2）。
- **现有 section 的全部职能可按 provider 拆开**：`LocalAgentSettingsSection.tsx` 的内容是 roster 驱动的逐 harness 行——认证状态点、登录/重新授权/登出（经 `runCommand` 跑 `/<harness> login|logout|code`）、device-code 提示、OAuth 码粘贴、登录成功 toast——每行的数据和动作本来就只属于一家 provider。它还留了两个子槽给 provider 加行（dsh 的 enable 开关在用 `row-action`）。唯一会丢的能力：**未安装 provider 的「未安装」占位行**（KNOWN_HARNESSES 发现位），卡片形态做不到（没装就没卡）——接受，README 与家族文档承担发现职责。

## 方案

### 1. 配置分层与迁移

- 每家 provider 新增/扩展自己的 settings 命名空间：`local-agent-kimi` / `local-agent-codex` / `local-agent-claude-code` / `local-agent-dsh`（dsh 扩现有 schema）。字段：
  - `live?: boolean`
  - `liveMirrorGranularity?: 'event' | 'token'`
- 字段**可选**：未设置时回落 Cordis config 值，再回落内建默认。有效值 = `settings ?? yaml ?? default`，YAML 从"唯一来源"降级为"部署级默认值"。
- `liveIdleMs` 不进卡片（高级项，留 YAML）。

### 2. 热切语义（host 侧）

照 dsh 的 generation+sync 模式，每家 provider 把 driver 构造从「apply 时一次性」改为「有效配置的函数」：

- 有效配置变化 → generation++：**关闭**时 gate 新轮（不再借出 runtime），立即回收空闲 runtime，in-flight 轮在原 runtime 上自然跑完、归还时回收；**开启**时下一轮惰性拉起。
- driver 侧需要一个小的 **drain 语义**（拒绝新轮 + 空闲即回收），与 teardown 的 `disposeAll`（立即中止握手、全回收）区分开——四家同构小改，kimi 先做样板。
- in-flight 的 run 任何情况下不被设置切换打断。

### 3. 卡片 UI（client 侧）

每 provider 一张卡，`settings.plugin.item` key 对到自己的命名空间；手绘组件（官方无表单生成），抄 context-guard / ui-shortcuts 的 scope 绑定与 revision-fenced 写。卡片分两个区块：**认证**（从 section 迁入：状态点 + 登录/重新授权/登出 + device-code 提示 + OAuth 码粘贴 + 成功 toast，数据与动作经 core 的 Remote `roster/status/runCommand`，逐 provider 过滤到自己）与**常驻模式**（live 开关、粒度单选、差异提示、覆盖徽标——值被卡片覆盖 YAML 默认时显示「已覆盖部署默认 · 恢复默认」）。

**共享组件放 core**：认证区块的交互（登录轮询、toast、码粘贴）在四家之间逐字相同，由 core 包导出共享 client 组件（如 `<ProviderAuthBlock harnessId>`）与 Remote 类型，provider 包引用——家族内 core/companion 依赖是既有制裁模式（providers 本来就 `inject: ['localAgent']`），不产生新的跨包边。dsh 的 enable 开关从 `row-action` 子槽迁进 dsh 自己的卡片。

样式草图（Plugins → 可配置插件 tab 内，每家一卡）：

```
┌ 设置 · Plugins · 可配置插件 ─────────────────────────────────────────────┐
│                                                                          │
│ ┌─ Local Agent · Kimi ────────────────────────────────────────────────┐  │
│ │ kimi CLI 0.36.1                                      ● 已认证 · 待命 │  │
│ │ ── 认证 ─────────────────────────────────────────────────────────── │  │
│ │ 通过 Kimi 账号登录。                            [ 登出 ] [ 重新授权 ] │  │
│ │ ── 常驻模式（live） ─────────────────────────────────────────── ⓘ │  │
│ │ 启用                                                      [ ●━━━ ] 开 │  │
│ │   输出粒度    ( ) 按消息折叠      (•) 逐字流式                    ⓘ │  │
│ │ 已覆盖部署默认（yaml: live=false）                        [ 恢复默认 ] │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│   ⓘ 悬浮展开：常驻模式 = 成员进程常驻——输出实时流入成员会话、取消不杀     │
│     进程、崩溃后自动续上原会话；关闭则每轮独立进程，跑完一次性出结果。     │
│     粒度 ⓘ 悬浮展开：按消息折叠 = 节流折叠、事件少开销低；逐字流式 =     │
│     每个 chunk 直写会话、打字机跟手。最终文本两档一致。                    │
│                                                                          │
│ ┌─ Local Agent · Codex ──────────────────────────────────────────────┐  │
│ │ codex CLI 0.144.0                                ○ 未认证 · 运行中…  │  │
│ │ ── 认证 ─────────────────────────────────────────────────────────── │  │
│ │ [ 登录 ]                                                            │  │
│ │ ┌ 请在浏览器完成授权：https://auth.openai.com/…  [ 打开页面 ] ─────┐ │  │
│ │ │ 等待授权完成（自动检测）…                                         │ │  │
│ │ └──────────────────────────────────────────────────────────────────┘ │  │
│ │ ── 常驻模式（live） ─────────────────────────────────────────── ⓘ │  │
│ │ 启用                                                      [ ━━━● ] 关 │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│ ┌─ Local Agent · Claude Code ── … ─┐  ┌─ Local Agent · dsh ── … ─┐   │
│ └──────────────────────────────────┘  └────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

行为细节：

- 卡片只在该 provider 已安装时存在（包即卡片，未安装自然无卡）——不用 room 的用户、不装某 provider 的用户完全不受影响。
- 开关切换即时写入（revision-fenced），卡片显示「下一轮生效」；切换时若有 in-flight 轮，提示行显示「进行中的轮次不受影响」。
- 「恢复默认」删除 settings 覆盖，回落 YAML 值。
- **说明文字全部收进 ⓘ 悬浮提示**（区块标题与粒度各一个 ⓘ，hover 展开），默认不占卡片行高；文案内容照下一条写。
- 粒度语义（ⓘ 提示文案照此写）：两档都是 live 模式内的投递频率——「按消息折叠」把 CLI 的 token 增量节流过一遍折叠层、按完整消息落会话（事件少，落盘/广播/渲染开销低）；「逐字流式」把每个 chunk 直接 append 成 `assistant/chunk`（打字机跟手，事件数多约两个数量级）。最终文本内容两档一字不差。
- 认证区块行为与现 section 逐字一致（登录轮询 4s / 5min 上限、pending→authenticated 弹 toast）；dsh 卡无登录按钮（凭据走宿主），只显示状态 + enable 开关。
- **鉴权红线（用户要求）**：本提案不触碰任何 host 侧鉴权/凭证链路（credential 存储、token 同步、登录命令实现一律不动）——认证区块是纯 UI 搬迁，复用现有 Remote 的 `status/runCommand`。claude-code 授权当前未通，其实现照常跟进但**实测豁免**：验收跑 kimi + codex 两家。

### 4. retire 独立 section

四家卡片全部落地后：core 撤掉 `settings.section` 贡献与 `LocalAgentSettingsSection` 组件、删除 `local-agent.settings.row` / `row-action` 子槽声明（dsh 已迁走，无其他消费者——家族内 grep 确认）。这是一次家族内的用户可见搬迁：CHANGELOG 与 README 写明「认证管理移至 Plugins → 可配置插件」。

### 5. 测试

- 合并优先级：settings > YAML > 内建默认（三家取值矩阵）。
- 热切：开 → 下一轮走 live；关 → 空闲 runtime 立即回收、in-flight 轮跑完再回收、后续轮回退 exec；反复切换无泄漏（runtime 计数核算）。
- drain 语义：drain 中拒绝新轮（落 exec 回退）、不打断 in-flight。
- 卡片：渲染（认证区块各态 × live 开关/粒度/覆盖徽标三态）、写入走 revision fence、provider 缺席不渲染。
- 认证区块平价：共享组件在四家卡里的行为与现 section 逐状态对齐（登录轮询、toast、码粘贴、登出）。
- 回归：家族全绿 + `check:plugins`；section 撤除后设置页无悬挂引用（grep 子槽名为零）。

### 6. 兼容性与文档

- 四家 README 的 Compatibility 节补一行「live 可在设置页热切」；`dsh.compat` 无需变（无新宿主能力）。
- docs/ops.md 的 live 上线段落改为「YAML 设部署默认，设置卡片做用户级覆盖」。
- CHANGELOG 记用户可见搬迁：认证管理从「本地 Agent」tab 移到 Plugins → 可配置插件。

## 里程碑

- **M1 kimi 样板**：命名空间 + 合并逻辑 + drain 语义 + 热切 controller + core 共享认证区块 + kimi 卡片（认证 + live，说明文字收 ⓘ 悬浮）+ 测试；3080 实测（卡片开 live → 委派一轮看增量流入 → 关 → 确认回退 exec；卡片走一遍重新授权）。
- **M2 三家复制**：codex / claude-code / dsh（dsh 扩现有命名空间，enable 开关迁入自家卡片）同构接入。实测只跑 kimi + codex；**claude-code 授权当前未通，实测豁免**（鉴权红线见 §3），dsh 无登录流程。
- **M3 retire section**：撤 core 的 `settings.section` 贡献与子槽，删 `LocalAgentSettingsSection`。
- **M4 文档与收尾**：README/ops/CHANGELOG 更新，提案验收关闭。

每个里程碑独立 commit + Agent Note；M1 未验收前 M2 不开。

## 风险

- **drain 与 disposeAll 的边界**：热切回收若误伤 in-flight 轮就是事故——M1 必须用「in-flight 中切换」的专项测试钉死，M2 复制时逐家重跑。
- **设置全局生效**：多会话并发委派时切换影响所有后续轮；卡片文案明说，不做按会话隔离（超纲）。
- **schema 演进**：命名空间字段后续加项要保前向兼容（旧卡片读新值、新卡片读旧值都不炸）——字段全部可选 + 未知字段忽略。
- **发现位损失**：section 的「未安装」占位行随退休消失，新用户少一个「还能装哪些 provider」的提示——接受，由 README/家族文档承担。
- **共享组件耦合**：认证区块进 core 的 client 面后，core 发版节奏影响四家卡片——改动走 minor 并四家同步验证，不在热修里动共享组件。

## 实现记录

- M1 kimi 样板已落地（分支 `feat/local-agent-live-settings-card`，worktree `dsh-plugins-wt-live-settings`）：host 侧 `src/live-switch.ts` 的 `LiveDriverSwitch`（settings 命名空间 `local-agent-kimi` 以 YAML config 作 composition base，三层合并零手写；热切换代 + 旧代 `drain()`——拒新轮、in-flight 不打断、空闲即回收；粒度切换走 `setLiveMirrorGranularity` 同代生效；换代门闩按成员回退 exec），driver 新增 `drain/hasRuntime/setLiveMirrorGranularity`，provider 改吃每成员解析器（直传兼容）。client 侧 core 抽共享 `ProviderAuthBlock`（section 逐字平价，M3 才撤 section），kimi 长出 client 半：`settings.plugin.item` 卡片（认证区块 + live 开关 + 粒度单选 + 覆盖徽标/恢复默认 + ⓘ 悬浮说明）。测试：kimi 105 绿（host 96 + client 9），core 174 绿（含平价套件），全仓 build/test 双 0，门禁全过。Agent Note：`.agents/notes/implemented/feature/2026-08-27-local-agent-live-settings-card-m1.md`。
- M1 真机验收已过（2026-08-27，演示实例 `~/.dsh-live-demo`，端口 3291，link 到 worktree）：卡片在「插件配置」tab 渲染，认证区块显示已登录（凭证从 3080 scoped home 拷贝，全程未触碰）；ⓘ 悬浮出差异说明；开 live → `settings.yaml` 落 `live: true` + 覆盖徽标/恢复默认出现；委派一轮走 live（常驻 `kimi acp` 拉起，委派记录在 session/new 时即落 ACP session id，结果交付后进程常驻）；关 live → 进程数秒内被 drain 回收、设置落 `live:false`；再委派走 exec 一次性（跑完无残留进程）；开 live + 逐字流式 → 子会话实时出现 `assistant/chunk`（含 reasoning-delta）。claude-code 按约定豁免；codex/dsh 属 M2。
- M1 后续修复（同分支合 main）：live 镜像空折叠三棍因（ACP session id 前缀、存活会话全量 persistence append 撞 seq 契约、settle 与 wire 落盘竞争 + 用量边界），提问排序（轮开始自写 user/message + 折叠 turn+text 去重），token 粒度流式收尾（settle 合成一条最终消息打在流式同 (turn,step)，消除重复渲染与悬挂流「已停止」）。Agent Note：`.agents/notes/implemented/feature/2026-08-27-kimi-live-mirror-fold-fixes.md`。
- M2 三家复制已落地（分支 `feat/local-agent-live-settings-card-m2`）：codex / claude-code / dsh 同构接入（settings 命名空间 + composition base + LiveDriverSwitch 热切 + drain 三件套 + provider resolver + 每 provider 一张 `settings.plugin.item` 卡）。dsh 在既有 `enabled` 开关上扩 schema（enabled 管注册存在性、live 管驱动模式，两者独立可组合），其开关从 `local-agent.settings.row-action` 子槽迁进自家卡片。镜像检查三家全命中并修复：codex 三处、claude-code 两处、dsh 两处全量 `sessionPersistence.append` 改走 `persistIfStandalone`（kimi 根因 2 的同型）。测试：codex 90 / claude-code 83 / dsh 90 包级绿，全仓 build/test 双 0。Agent Note：`.agents/notes/implemented/feature/2026-08-27-local-agent-live-settings-card-m2-{codex,claude-code,dsh}.md`。
- 工具名对齐（M2 附带）：codex / claude-code 的委派工具名从 `subagent_codex_local` / `subagent_claude_code_local` 改为官方模型面向名 `subagent_codex` / `subagent_claude_code`（官方 preset 行出厂即 `disabled: true`，两家 patch 各加一行对官方行的 disable 兜底；用户在自己 preset 层显式启用官方行会响亮撞名——刻意如此）。provider 名（`codex-local` / `claude-local`）不变。根 README、两家 README、tool-subagent README 同步。
- token 粒度流式收尾（M2 后续，分支 `feat/local-agent-token-stream-final`）：codex / claude-code 照 kimi 契约落地——settle 合成一条最终 `assistant/message` 打在流式同 `(turn, step)`（`[reasoning, text]` + usage + sourceEventSeqs，非 completed 带 `interrupted: true`），折叠层 token 模式跳过 think/text 正文；dsh 无需改（子实例原生官方事件流）。Agent Note：`.agents/notes/implemented/feature/2026-08-27-{codex,claude}-token-stream-final.md`。
- 卡头认证状态点（用户要求）：折叠卡头显示红绿灰状态点，一眼看出各 provider 授权状态——core 出认证状态总线（`auth-status.ts`，ProviderAuthBlock 发布每次探测，卡头 `useHarnessAuthStatus` 订阅 + 空总线补探一次）+ `AuthStatusDot`，四卡接入。Agent Note：`.agents/notes/implemented/feature/2026-08-27-settings-card-auth-status-dot.md`。
- 3080 已全量上线（2026-08-27 三次 deploy:3080，canary 全 PASS）：core + kimi + codex + claude-code + dsh。真机验证点：四卡片 + 卡头状态点、两个新工具名调用、各家 live 热切、token 粒度流式渲染。
