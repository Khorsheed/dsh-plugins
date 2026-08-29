# 多 agent 房间以「会话内邀请 agent」为入口，而非独立新建（room-session-promotion）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-27
- **查重结果**：已搜 `proposals/active/`（local-agent-delegation-api、local-agent-member-channel、local-agent-member-state 等均为 local-agent 家族**供给侧**，非本意图；datasets/mission 等无关）、`proposals/closed/`（空）、`.agents/notes/`（含 archived）。最邻近是 `.agents/notes/implemented/feature/2026-08-18-room-multi-agent-conversation.md`——那是 room 的能力设想与需求来源（设计 note，原始设想）；本提案是该能力在 room 插件侧的**能力账本立项**，两者关系是「设计 note（设想）+ 提案（能力意图总账）」；delegation-api / member-channel 两条提案是它们的供给侧（local-agent 门面 / 成员互通知），与本意图不同面。无重复，新建。
- **官方依赖**：纯插件。所需官方契约均已实测存在（见「现状」）：会话自定义事件（`room/created` 等）、客户端 `conversation.view` / `conversation.chat.node` / `conversation.composer` 槽位、`ctx.sessions` / `ctx.subagents`，以及家族委派门面（`ctx.get('localAgent')` 探针）。零 harness 改动。

需求来源：与用户的架构评审（2026-08-27）——把「room」从与会话并列的独立创建物，重定义为「一个被 agent 进入后自然具备多 agent 能力的会话」，并明确保留 local-agent（引擎/家族）与 room（表面）两层、不熔合为一个包。

## 目标

room 目前是前端单列的「+ New room」创建流，作为与「+ New session」并列的另一类新增会话对象。本提案把入口模型改成：

1. **入口统一**：不再单列「+ New room」创建流；而是**任意会话**里邀请一个 agent 进入，该会话即被提升为 room（懒写 `room/created` + 首条成员记录），从而具备 room 的全部能力。
2. **保持既有 room 能力**：对话、成员 tab、成员互相召唤、多成员胶囊、任务板、通知闸门、名册注入——全部照常。它们基于 room state（名册）渲染，只要提升时写入名册即工作。
3. **守住分层**：local-agent 仍是家族引擎（子 agent 委派、成员通道、斜杠命令、设置），room 仍是其上的一层表面；两者**不熔合为一个包**。引擎可被 room 之外（任意会话的 `subagent_<provider>` 工具、taskpilot、未来表面）单独复用；room 可独立安装/卸载。

一句话：把「room」从「与会话并列的新建物」重新定义为「一个被 agent 进入后自然具备多 agent 能力的会话」。这是本提案的能力意图。

非目标 / 明确不做：

- 不把 room 与 local-agent **物理合并**成一个插件包（理由见「风险 / 放弃的东西」，这是刻意放弃）。
- 不做 agent-to-agent 自主多轮往返（闸门归属 room，留二期；本提案不改 `receiveMemberMessage` 探针语义）。
- 不改 harness、不新增会话类型（room 仍用自定义事件标记）。

## 现状（官方契约实测 / 已有实现）

room 侧（`room` 分支，`packages/room`，均已核实）：

- 独立包 `@khorsheed/dsh-room`。room = 一条普通 dsh 会话 + `room/created` 自定义事件标记（`journal.ts` 的 `isRoomLog`），状态全部经 `room/*` 事件日志折叠（`replay`），持久化/重载回放免费。
- 创建流：`NewRoomAction`（侧栏「新建 Room」按钮，套官方 New Session 按钮 chrome）经 Remote `createRoom` 建一条会话并写 `room/created` + 首条 `room/member-added`（`MAIN_AGENT_MEMBER`，`kind: 'main-agent', invitedBy: 'human'`，`index.ts:264-278`）。另设 `BlankRoomRegistry`（`registry.ts`）做「reuse-or-create」记账——记录从未跑过回合的空白 room，防止同一 cwd 下堆叠。
- 成员：首条 main-agent 成员在创建时加入；外部成员 = local-agent 家族 CLI provider 委派（一条 dsh 子会话，`parentSession = room 会话`），经家族 resume registry 续轮（`dispatch.ts` 经 `adapter.ts` 探针调 `ctx.localAgent.start/resume/cancel`）。
- 表面：`MembersView`（成员 tab，`conversation.view` 槽）、`InviteDialog` 邀请框、`RoomComposer`（@-分发）、`RoomSpeechView`（成员发言节点）、`RoomDockCapsules`（多成员胶囊）、`RoomTaskLineView` / `RoomTodoStrip`（任务板）、通知闸门（`receiveMemberMessage`）。全部渲染基于 `replay(room.events)` 的 `RoomState`。
- **身份标记与成员记录都是自定义事件**：提升只需在首次邀请时写 `room/created` + `room/member-added`，`isRoomLog` 与折叠逻辑逐字不变。触发时机可从「创建时」改为「首次邀请时」。

local-agent 侧（`main`，`packages/local-agent`，均已核实）：

- `LocalAgentRegistry` 即 `ctx.localAgent`，提供已被消费的 M1 委派门面 `start/resume/cancel`（delegation-api 提案已落地）与名册 `roster/statusOf`。
- 家族定位是「在任意会话里把工作交给本机 CLI 子 agent」，服务 room 之外还有 taskpilot 与任意会话的 `subagent_<provider>` 工具（README 明确此定位）。
- 家族对 room 只有一个**可选探针边**：`member-channel.ts` 用鸭子类型 `ctx.get('room')` 探测 room 的 `receiveMemberMessage` 门，room 缺席/拒绝则家族直发。**无硬依赖**。

两者当前解耦方式（已核实）：room `adapter.ts` 探 `ctx.localAgent`（type-only import + 运行期 `ctx.get('localAgent')` 方法存在性检查），absent 则 CLI 成员能力降级、绝不崩；local-agent 探 `ctx.get('room')`。这正是 AGENTS.md 的「independent, but compatible」sanctioned pair 形态——独立的、但兼容的。

## 方案

全部改动落在 `packages/room`（与 local-agent 的交互保持现有探针，零家族改动），无 harness 改动。

### 1. 提升语义：邀请 agent 即提升

新增唯一入口函数 `ensureRoom(session)`：若 `!isRoomLog(session.events)`，向该会话追加 `room/created` + 首条 `main-agent` 成员记录（`room/member-added`），返回提升后的会话。之后的邀请/成员操作照用既有写入路径。

- 触发点：邀请 agent 的入口（§2）在确认前先 `ensureRoom`，再写入该成员的 `room/member-added`。
- 幂等：已是 room 的会话 `ensureRoom` 为 no-op；并发下由事件日志「首个 `room/created` 定身份」的语义天然收敛。
- **身份不再依赖「创建即 room」**：`isRoomLog` 与 `journal.ts` 折叠逻辑逐字不变，只是触发时机从「创建时」提前到「首次邀请时」。

### 2. 入口统一：邀请从「+ New room」挪到「任意会话」

- 去掉前端独立的「+ New room」创建流（`NewRoomAction`），把「邀请 agent」入口暴露为**任意会话**都可触达的动作（composer / 菜单 / 会话头），点开即走现有 `InviteDialog`。
- 「+ New session」维持原样；一个会话要不要成为 room，只看它有没有被邀请进来的 agent 成员，而不是它是不是「新 room」。
- 空白、从未跑回合的会话不再需要 `BlankRoomRegistry` 的 reuse-or-create 记账——因为你不会「先新建一个空 room 再忘掉」，而是在当前会话里邀请。该 registry 随之退役（或其语义改为「被提升过但从未跑回合的会话」，仅确需时才保留，见「风险」）。

### 3. 信息架构（命名 / 文案）

- 保留 `room` 作为能力词与包名（`@khorsheed/dsh-room`），不随入口模型改动而改名。
- UI 文案从「新建 Room」改为「（在此会话）邀请 agent」或「把此会话变成多 agent 房间」，让用户理解「room = 带 agent 的会话」。
- 若后续确需强调「会话里可驻留多个 agent」，在会话的成员 tab / 标题处轻量展示即可，而非再造一个创建对象。

### 4. 分层边界（本提案的核心取舍）

- local-agent 保持引擎/家族：`inject: ['localAgent']` 仅作为可选探针，room 缺席时家族零影响；家族可用范围（任意会话 subagent 工具、taskpilot）不变。
- room 保持表面：经 `adapter.ts` 探 local-agent，absent 则 CLI 成员能力降级（main-agent 成员仍工作）。
- **不新增任何跨包硬依赖、不修改现有 sanctioned pair**（room↔localAgent 的探针边维持）。independence checker 无需新 sanction。

### 5. 测试

- room：提升单测——非 room 会话经 `ensureRoom` 后 `isRoomLog` 为真、`replay` 出含 main-agent 成员与首条记录的 state、幂等；邀请触发提升的 host spec。
- 回归：现有 room host/client spec 全绿；local-agent 家族既有测试绿；不装 room 的 profile 行为逐字不变。
- 前端：去掉「+ New room」后，现有 room 能力（成员 tab、胶囊、@-dispatch、任务板）在「被邀请提升的会话」上仍渲染正确（基于 room state，与创建路径无关）。

## 里程碑

- **M1 入口模型**：`ensureRoom` + 邀请入口通用化 + 移除「+ New room」创建流；`BlankRoomRegistry` 退役或改义。落地后「任意会话邀请 agent → 变 room → 具备全部 room 能力」。
- **M2 信息架构**：文案与轻量展示（「带 agent 的会话」/ 成员 tab 标题等）。
- **M3 分层审计**：复核 room↔local-agent 仍是探针、无硬依赖；若 independence checker 需要则补 registry 说明；README 定位表述同步。

每个里程碑独立 commit + Agent Note（AGENTS.md 要求），本提案「实现记录」登记。

## 实现记录

- 2026-08-29（room 分支）：M1 落地。`ensureRoom` 成为唯一提升入口（invite/messageMember/room_invite/room_message 经它提升，其余写入路径仍要求已是 room）；「+ New room」创建流整体移除（`NewRoomAction`、`createRoom` Remote、`BlankRoomRegistry` 及其注册表文件/配置）；「邀请 agent」挂上 `conversation.session.header.actions`（所有会话可见），成员 tab 的非 room 态改为引导态；store 的实时订阅对缓存为非 room 的会话改为去抖重探 `isRoom`（工具驱动的提升因此即时可见）。测试 172 全绿。

## 验收标准（done 判定，绑定可插拔交付）

- 在不装 room 的 profile 下，任意会话行为与现在逐字不变（无 room 表面、无成员 tab、无 @-分发）。
- 装了 room + 至少一个 CLI provider 的组合下：在一条**普通会话**里邀请一个 agent，该会话立即具备 room 能力（成员 tab 出现、`room/created`+成员记录写入、重载该会话身份/名册完整恢复）；main-agent 成员也能通过 @-分发。
- 多成员胶囊、成员互相召唤（成员 tab 召唤 / 成员互 @）、任务板、通知闸门，在「被邀请提升的会话」上渲染与「创建即 room」一致（基于同一 `RoomState`）。
- 「+ New room」入口不再存在（或已改义）；无孤立空白 room 堆叠（blank-room 记账不再产生）。
- 分层约束：local-agent 家族在**未装 room** 的 profile 下行为逐字不变（现有测试全绿）；room 在**无 local-agent 门面**的组合下 CLI 成员能力降级、main-agent 成员仍工作，不 boot 崩溃。
- 交付形态：改动随既有 `@khorsheed/dsh-room` 包发布，零 harness 改动；README 的 Compatibility 与定位表述同步更新。

## 风险 / 放弃的东西

- **「room 只在有 agent 成员时才有意义」的取舍**：本模型下，一个「只有 main-agent、无任何外部 agent」的 room 不再作为独立创建物存在（它就是一个普通会话）。若未来确需「无 agent 也要 room 黑板/任务板」的纯人场景，属能力回退——需在 room 留一个显式「提升为 room」的手动入口（非邀请触发）。本提案默认不做，但入口设计保留该余地。
- **信息架构 / 心智成本**：把「room」从对象改为「会话具备的属性」，会让「room 与 session 的边界」在 UI 上变模糊；靠成员 tab 与「邀请 agent」入口承载，需做一轮文案/草图验证。
- **blank-room 记账的语义变化**：去掉「+ New room」后，`BlankRoomRegistry` 的 reuse-or-create 不再需要；但「被提升但从未跑回合的会话」在刷新后可能因官方 `sessionBlank` 语义从侧栏消失——需确认该场景是否仍要处理（若已在当前会话，通常不成问题）。
- **合并成一个插件的路径被放弃**：这是本提案**明确不做**的。理由：local-agent 是家族引擎，服务 room 之外的任意会话 `subagent_<provider>` 工具 / taskpilot，且 provider 子包各自 `inject: ['localAgent']`；若熔合，只想要子 agent 工具的消费者会被迫背上整个 room UI，provider 也会连带 room 表面，违反「independent, but compatible」与发布粒度。若要「少装一个包」，用「推荐配对」而非熔代码。
- **依赖 room 的既有 member-channel 探针语义**：local-agent 对 room 的门控（`receiveMemberMessage`）仍依赖「room 在场」的判定；本提案不改该探针，故成员互通知的闸门行为不变。
