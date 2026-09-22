# Agent Note: local-agent 成员通道 —— gateway remote + 可写成员 composer（M1+M2）

Status: implemented

[English](2026-08-19-local-agent-member-channel.md) | 中文

## Problem

家族 CLI 成员的 dsh 子会话此前是只读的：官方 composer 管线的每条发送路径都拒绝 one-shot 子会话，而 ui-subagent 的链条目（`conversation.composer`，priority -10）为它渲染静态只读面板。[成员通道提案](../../../proposals/closed/2026-08-19-local-agent-member-channel.md)要把成员会话变成双向通道：人打开成员会话时得到可写 composer，发送 = 继续同一个 CLI 会话（facade resume），run 进行中可 Stop——且不改动宿主。本 note 记录该提案的里程碑 M1（通道）与 M2（composer）。

## Decision

**M1 —— 通道（`packages/local-agent` 宿主侧）。** `LocalAgentGateway` 新增三个 remote，registry 新增一个访问器：

- `LocalAgentRegistry.getDelegation(childSessionId)`——对既有 `delegations` 映射的只读、不抛异常查询。与 `resolveDelegation` 不同，它不做归属断言：人打开的是真实子会话，记录本身就是授权来源，不存在模型伪造句柄的攻击面（resume 句柄从不进入 prompt 文本）。
- `memberOf(childSessionId)`——composer 的成员判定：返回委派视图 `{ childSessionId, provider, parentSessionId, harnessDisplayName? }` 或 null。CLI 会话 resume 句柄（`cliSessionId`）刻意不上 wire。
- `promptMember(childSessionId, text)`——组合 `getDelegation` 与未改动的 facade `resume(record.parentSessionId, record.provider, childSessionId, [{ type: 'text', text }])`。一切 facade 失败（未知成员、父会话不在线、resume 锁占用……）都映射为结构化 `{ ok: false, error }`——原始异常绝不越过 wire——composer 内联渲染原因（v1：fail loud，「先打开父会话」）。
- `stopMember(childSessionId)`——直达 facade `cancel`，返回布尔值。

wire 类型（`LocalAgentDelegationView`、`LocalAgentPromptResult`）放在 `src/types.ts`——typert wire-schema 生成器要求的公开非根 subpath；下一次 build 时生成的 `lib/typert.remote-client.d.ts` 即带出新方法。

**M2 —— composer（`packages/local-agent` 客户端侧）。** 挂在 `conversation.composer` 上的一条 chain 条目：

- **两段式成员判定**——chain 槽契约要求 selector 必须是 owner props 的纯函数，这是它的直接后果。`selectCliMember` 只用会话快照粗筛：`session.subagent?.address.mode === 'one-shot'` 即当选，携带 `{ childSessionId }`。宁宽勿漏：当选的 `MemberComposer` 随后查询 `memberOf`，家族从未委派的会话渲染与官方接管一致的只读面板（视觉对齐 ui-subagent 的 `SubagentReadOnlyComposer`，同样的 token 与尺寸）——绝不给非成员会话呈现可写输入框。
- **priority -20 选举**——ui-subagent 的只读接管在 -10，chain 选举升序、先中先得，所以成员 selector 先跑。先当选是安全的，因为降级分支渲染的恰是接管本会渲染的内容。
- **可写 composer**——输入框 + 发送 + Stop，外观照 `InputBar` 抄（同样的 card/input/primary token），但状态机自写：草稿是本地 state，发送调 `promptMember`（绝不走 `inputActions.submit()`），结构化错误内联渲染；成员 run 进行中（会话自身的 `running` 标志，由镜像 transcript 事件驱动）输入禁用、Send 换成 Stop（→ `stopMember`）。官方输入机刻意不接入：`InputBar` 的发送路径焊死在宿主 prompt 管线上（`inputActions.submit()` 加上输入机的 adjudication），其禁用判定也属于那台机器——皮可以抄，壳不能包。
- 文案放在插件自己的 `local-agent` locale 命名空间（zh 为键集基准，en 镜像）。

## Alternatives considered

- **包壳或复用官方 `InputBar`**——否定：它的发送路径焊死在官方输入机的 `inputActions.submit()` 上，而官方管线在每一层都拒绝 one-shot 子会话的发送（客户端本地 `subagent-not-resumable`、宿主子代理血统围栏）。只有视觉皮肤可以迁移。
- **实现官方 `prepareContinuable` 让成员成为 continuable 会话**——否定（提案 §0，已对 harness 源码核实）：continuation manager 的 followup 驱动的是进程内 dsh Agent，CLI 的 scoped home、凭证与会话链全部丢失。家族 seam（facade resume）是唯一能续上真实 CLI 会话的路径。
- **在 selector 里做成员探测来收紧粗筛**——契约上不可能：chain selector 是纯函数且同步，异步的登记查询放不进去。两段式判定（纯粗筛 + 组件时确认、降级只读）是契约的推论，不是一个选项。
- **给 registry 加一个捆绑「查记录 + resume」的专用方法供 gateway 使用**——作为冗余 surface 否定：gateway 组合既有的 `getDelegation` + `resume` 即可，归属语义只留在 facade 一处。
- **`memberOf` 直接返回完整委派记录**——否定：`cliSessionId` 是 resume 句柄，绝不该上 wire；视图只投影 composer 需要的内容。

## Consequences

- 任何家族委派（room 成员或主 agent 工具委派）零 room 改动即获得可写 composer；人的消息在同一个 dsh 子会话里续上同一 CLI 会话，transcript 镜像把它落为 `user/message`——composer 自己不写消息事件，避免双份。
- 家族从未委派的 one-shot 会话（selector 误判）显示与官方一致的只读面板；误判面在构造上安全降级。
- 官方未来若新增 priority 低于 -20 的条目会改变选举顺序——可见但安全（链条继续下落到本条目，再到只读接管）。
- composer 抄了 `InputBar` 的皮，官方输入框改版需手工跟进——接受，与 message-tools 遮蔽官方渲染器属同一维护类别。
- 父会话离线的发送以 facade 错误文案 fail loud；冷拉父 agent loop 留作后续。
- 成员互通知（鸭子类型的 `room.receiveMemberMessage` 探针边、桥接 MCP server、每 run token）在本 note 撰写时保留给 M3，此后已落地——见[成员互通知 note](2026-08-19-local-agent-member-notification.md)；local-agent → room 的边保持鸭子类型，`check-plugin-independence` 无需 sanction。
- **更正（2026-08-20）：统计行并不随选举存活。** M2 计划假设官方 `StatsLine` 挂在独立于 composer 链的 `conversation.composer.dock` list 槽上；真实环境反馈确认 dock 是作为 fallback InputBar 的 `footer` prop 传入的（harness `ConversationRoot.tsx:154-156`），而 `overlay: true` 下当选条目会隐藏整个 fallback——成员会话因此没有统计行。提案写明的备选路径现为落地实现：MemberComposer 在可写卡片下方用 `tokenUsage` 投影自渲染一条独立居中的 dock 统计行（对齐官方 StatsLine 排版：chat 内容宽、居中、12/20 tertiary）（缓存命中率按三个计费桶计算 + 紧凑格式的输入/输出总量；会话无任何 token 活动时整行不渲染；run 进行中显示上次 settle 的数值）。降级只读分支刻意保持与官方面板视觉一致——那里没有统计行。turn/step 计数与时序分组是 dsh-agent 概念，CLI 成员不渲染。

## Testing

`packages/local-agent/tests/gateway.spec.ts` 新增成员通道套件（7 例）：`memberOf` 命中/未命中；`promptMember` 对 fake subagents provider 的全链路（facade resume 收到记录里的 parent/provider，prompt 只含人的文本、绝不含 CLI 会话句柄），未知子会话、父会话无 live agent、resume 在飞三类结构化错误；`stopMember` 命中/未命中并观察到 abort 信号。`packages/local-agent/tests/member-composer.client.spec.tsx`（14 例）：selector 纯度（one-shot 当选 / continuable 拒绝 / 普通或缺省会话拒绝），`memberOf` 返回 null 时的只读降级渲染，发送以子会话 id 与 trim 后文本调用 `promptMember` 并清空草稿，结构化错误与 RPC 失败兜底内联渲染，成员运行中输入禁用且 Stop 调 `stopMember`，以及统计行：无用量时不渲染、缓存命中率按三个计费桶计算、token 总量紧凑格式、降级只读分支不出现统计行。测试套件：local-agent 138/138，local-agent-tool-subagent 10/10。

## Cross-references

- [成员通道提案](../../../proposals/closed/2026-08-19-local-agent-member-channel.md)——本 note 实现的里程碑计划（M1+M2）。
- [委派 facade](2026-08-18-local-agent-delegation-facade.md)——gateway 组合的 resume/cancel facade。
- [run 进度](2026-08-19-local-agent-run-progress.md)——composer 运行态将消费（M3 实时镜像）的进度通道。
- **更正（2026-08-23）：有待处理交互时必须让出选举。** 官方 `ApprovalPanel`（提问/审批弹窗）本身就是 `conversation.composer` 链上 priority 1 的条目；本条目在 -20 先选举会把它遮蔽——成员会话里待答的 ask-user-question 永远渲染不出来。`selectCliMember` 现在在 `owner.interactions` 非空时返回 null，让交互 UI 当选。接管 composer 的通用规则（已有测试钉住）：有 pending 交互 → 让出；运行中 Stop → 自己实现（成员走 `stopMember`）。
