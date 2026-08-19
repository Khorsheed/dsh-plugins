# local-agent 成员会话双向通道（可写 composer + promptMember Remote）（local-agent-member-channel）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-19
- **查重结果**：已搜 `proposals/active/`（datasets-mission-bench、local-agent-delegation-api，均非同一意图）、`proposals/closed/`（空）、`.agents/notes/`（含 archived）。最近邻是 room note（`.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`）的「人直接打开成员会话发消息」诉求与本仓库的 `local-agent-delegation-api` 提案（本提案的宿主 API 底座，M1–M4 已落地）。无重复，新建。
- **官方依赖**：纯插件。composer 侧用官方文档化的 chain 槽 priority 选举机制（`conversation.composer`，ui-slots 升序选举、先中先得；message-tools 遮蔽 `conversation.chat.node` 为同源先例）；发送侧走家族自有 Typert Remote + 已落地的 `ctx.localAgent.resume` 门面。零 harness 改动。

需求来源：room 第二轮评审——成员子会话成为双向通道，人直接打开成员会话发消息 = 续一轮，不经 room 转派；远期 agent 间直聊复用同一通道。room 原提议的手段（给 CLI provider 实现官方 `prepareContinuable`）经评估不可行（见「方案 §0」），本提案是替代路线。

## 目标

让家族 CLI 成员的 dsh 子会话从「只读回放」变成「可写通道」：

1. 人打开成员子会话时，看到**可写 composer** 而非官方只读面板；发送 = 对该成员续一轮（resume）。
2. 成员 run 进行中：composer 显示进行态 + Stop（中断 = M1 `cancel`）；transcript 靠 M3 实时镜像自动滚动。
3. 对**所有**家族委派生效（room 成员、主 agent 经 `subagent_<provider>` 工具委派的成员），不依赖 room 在场。
4. 不用 room 的用户的体验逐字不变：非成员会话、未装本家族的环境，composer 行为与官方一致。

非目标：CLI 主动发声（架构上不可能，CLI 进程只存在于 run 期间）；官方 continuable 语义接入（见 §0 的否定论证）；父会话离线时的发送（v1 fail loud，见「风险」）。

## 现状（官方契约实测 / 已有实现）

底座（本仓库，已落地于 `local-agent-delegation-api` 提案 M1–M4，已合 main）：

- `ctx.localAgent.resume(parentSessionId, provider, childSessionId, prompt, opts?)`：归属校验 + resume 锁 + 子会话 reattach + intent staging 一次封装；`cancel(childSessionId)` 中断；`delegations.jsonl` 跨重启持久化；M2/M3 提供 run 进度事件与实时 transcript 镜像。

composer 侧（harness 客户端，只读核实）：

- `conversation.composer` 是 chain 槽（`ui-conversation/.../contract/slots.ts:126-132`），session 作用域，owner 数据仅 `{ interactions, session }`；渲染点在 `ConversationRoot.tsx:170-174`，`overlay: true`（fallback 常驻挂载、当选仅隐藏，草稿不丢）。
- 选举规则（`ui-slots/src/index.ts:247-257`）：每条目一个**纯函数** `select(owner) => M | null`，按 priority 升序先中先得，全 null 回落官方输入框。
- ui-subagent 在 priority **-10** 注册了只读接管（`ui-subagent/src/client/index.ts:120-128`）：one-shot 子会话永远当选（`index.ts:44-53`），渲染静态只读面板（`SubagentReadOnlyComposer.tsx`）。continuable + 父在线时才让给默认 composer。
- 官方发送路径对 one-shot 子会话全部封死：`Session.prompt` 客户端本地拒（`subagent-not-resumable`，`client/runtime/.../sessions/session.ts:208-216`）；host `session.prompt` 有 subagent 血统围栏（`api/remotes/src/agent-lookup.ts:62-85`）；`subagent.prompt` 要求 continuable + live 父 Agent（`apiproxy.ts:2677-2714`）。
- 默认 `InputBar` 不可直接复用：自带禁用判定（`InputBar.tsx:136`）且发送焊死在官方输入机上——只能抄皮，不能包壳。

## 方案

全部改动落在 `packages/local-agent`（gateway + client 面）；不动 room、不动 harness。

### 0. 为什么不走官方 `prepareContinuable`（评审结论存档）

官方 continuable 模型中 provider 的 `prepareContinuable` 只返回种子数据，continuation manager 随后自行在子会话上创建并驱动**进程内 dsh Agent**（`subagent/src/types.ts:316-320`、`continuation.ts:1016-1023`）；`followup` 的机械动作是投递到该进程内 Agent 的 inbox（`continuation.ts:1130-1147`），没有任何钩子把 followup 翻译成外部 CLI 调用。给 CLI provider 实现它得到的只是一个与 CLI 无关的进程内子 agent，成员的 scoped home / 凭证 / CLI 会话链全部丢失。官方 README 也明确：外部 provider 需先有独立的 Activation 所有权契约（`subagent/README.md:147-148`，其中「user-authority 的成员 prompt」恰是官方自己留白的未来 seam）。结论：家族 seam 先行，上游契约扩展如需要另行提案，不阻塞本路线。

### 1. 可写 composer（client 面）

在 `@khorsheed/dsh-local-agent` 的 client 半注册 chain 条目：

```ts
ctx.slots.inject('conversation.composer', () =>
  ctx.slots.register({
    name: 'conversation.composer',
    priority: -20,                    // 小于 ui-subagent 的 -10，选举先跑
    select: selectCliMember,          // 纯函数粗筛，见下
  }, MemberComposer),
)
```

- **两段式成员判定**（selector 纯度约束的直接后果）：`selectCliMember` 只能用会话快照粗筛——`subagent.address.mode === 'one-shot'` 且会话在家族视角"可能是成员"（如有 parentId 即可，宁宽勿漏）；当选后 `MemberComposer` 向 gateway 查委派记录（新增只读 Remote `memberOf(childSessionId)`，读 `delegations` 登记），**查无记录则渲染与官方一致的只读说明**（视觉对齐 `SubagentReadOnlyComposer`），绝不把非成员会话盖成可写。
- **组件**：外观/交互照 `InputBar` 抄（输入框、发送、进行态、Stop），状态机自写：草稿本地保存、run 进行中输入禁用 + Stop 可用、错误提示。发送**不走** `inputActions.submit()`，调 §2 的 Remote。
- **进行态数据**：`localAgent/run-progress` 事件（M2/M3）经客户端既有订阅通道到达；transcript 本体由 M3 镜像实时进子会话，会话视图自滚动，composer 不管渲染。

### 2. 发送与中断 Remote（gateway）

`LocalAgentGateway` 新增两个写方法（user-initiated，反馈即 composer 与会话视图本身，不占 command 通道）：

```ts
@Remote('promptMember') promptMember(childSessionId, text): Promise<{ ok: true } | { ok: false; error: string }>
@Remote('stopMember')   stopMember(childSessionId): Promise<boolean>
```

- `promptMember`：按 childSessionId 查委派记录（registry 新增 `getDelegation(childSessionId)` 只读访问器），取记录里的 `parentSessionId` / `provider` 调 `ctx.localAgent.resume(...)`。**归属语义**：UI 端的人打开的是真实子会话本身，记录即授权来源，不存在模型伪造句柄的攻击面；resume 句柄依旧不进 prompt 文本。
- 父会话无 live Agent 时 facade fail loud，Remote 把错误原样返回给 composer 显示（v1 语义：先打开父会话/room）。
- `stopMember` 直达 `cancel(childSessionId)`。
- 人的消息正文经 resume 交给 CLI，由 M3 镜像以 `user/message` 落进子会话——composer 侧不手写消息事件，避免双份。

### 3. room 的消费方式（非本提案交付物，供 room 评审）

- room 无需任何改动即获得该能力（家族 composer 对所有成员会话生效）。
- room 若要感知"人绕过 room 直接向成员发的轮次"以更新黑板：订阅子会话的 `session/event` 或 `localAgent/run-progress` 即可；委派记录本就记在 room 会话名下，血缘不变。
- 远期 agent 间直聊：同一通道，调用方从人换成持有 live parent Agent 的 agent，facade 签名不变。

### 4. 测试

- client：selector 粗筛（one-shot 命中 / continuable 不命中 / 普通会话不命中）；MemberComposer 在 `memberOf` 查无记录时的降级渲染；发送/中断按钮调 Remote 的参数正确性。
- gateway：`promptMember` 全链路（记录存在 → facade resume 被调且参数来自记录；记录不存在 → 结构化错误；父不在场 → 错误透传）；`stopMember` 命中/未命中。
- 回归：local-agent 既有 101 例全绿；不装 client 半的 profile 行为不变。

## 里程碑

- **M1 通道**：`memberOf` / `promptMember` / `stopMember` Remote + registry `getDelegation` 访问器 + 单测。
- **M2 composer**：chain 条目 + MemberComposer（含降级渲染）+ client 测试。

## 实现记录

- 底座提案：`proposals/active/2026-08-18-local-agent-delegation-api.md`（M1–M4 已合 main）。
- 评审记录：room 第二轮评审（2026-08-19）提出双向通道诉求；其 `prepareContinuable` 手段经 harness 源码核实不可行（§0），本提案为替代路线。
- 背景 note：`.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`（消费方）。

## 验收标准（done 判定，绑定可插拔交付）

- 真实 profile：主 agent 经 `subagent_kimi` 委派一轮后，打开该子会话出现可写 composer；发送一条消息 = 同一 CLI 会话续一轮（子会话 transcript 与人的输入、成员回复均实时出现）；进行中 Stop 可中断。
- 跨重启：重启 profile 后打开昨天的成员会话，发送仍续上同一 CLI 会话（delegations.jsonl + reattach）。
- 降级：打开一个非家族委派的 one-shot 子会话（若有）渲染与官方只读面板一致的说明；不装本包 client 半的会话行为不变。
- room 复验：room 成员会话内直接发送生效，room 侧黑板能感知该轮次。
- 隔离性与门禁：家族全部既有测试绿；hygiene / note 格式 / 翻译配对门禁绿。

## 风险 / 放弃的东西

- **selector 粗筛的误判面**：只能靠当选后降级渲染兜底；若官方会话快照未来携带 provider 信息可收紧。
- **父会话离线**：v1 fail loud 引导先开父会话/room。冷拉父 agent loop（`agent-lookup.ts:136-197` 的官方先例）留作后续；若官方把 user-authority 的成员 prompt seam 落地（`subagent/README.md:148` 的留白），评估迁移。
- **UI 漂移**：MemberComposer 抄 `InputBar` 的皮，官方输入框改版时需跟进——接受，比照 message-tools 遮蔽官方渲染器的既有维护成本。
- **priority 竞争的未来冲突**：若官方新增更负 priority 的条目，选举结果变化—— chain 语义内可预期，降级安全（退回只读）。
- **明确放弃**：CLI 主动发声；官方 continuable 语义接入（§0）；父离线发送（v1）。
