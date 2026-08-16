# @khorsheed/dsh-client-message-tools

[English](README.md) | 中文

为 dsh Web 界面的用户消息提供「编辑」与「撤回」。浏览器半部分以官方用户消息渲染器的视觉克隆（`conversation.chat.node` 槽位、key `user` 与 `steering`、priority -1）替换默认渲染，新增复制/编辑/撤回操作行（撤回操作带本包自绘的 rotate-ccw 圆形回转箭头图标——ui-primitives 没有 undo 类图标），并注册四个 `ConversationNodeDefinition`：每次落地的撤回投影为可展开的「已撤回 N 条消息」分隔线（N = 该区间被隐藏的聊天节点数），每次编辑替换投影为带「已编辑」徽标的原位气泡，每条恢复条目投影为重放行——用户气泡（带完整操作行）与助手文本行共同组成「已恢复」组。Host 半部分是 `messageTools` Typert Remote 服务，有 `withdraw`、`edit` 与 `restore` 三个方法；客户端通过 `ctx.remote.$mount` 自行挂载生成的 Remote contribution，因此本插件可装入任意 profile，无需改动任何核心包。仍在排队的消息由官方队列条带自带编辑/移除（`conversation.updateQueue` 的 `{ kind: 'edit' | 'remove' }`)；它们还没落日志，不经过 surface 撤回机制。

编辑即原位替换：host 追加一条 `user/message` replacement，其内容就是编辑后的新文本（区间覆盖目标消息及 surface 尾部——编辑旧消息就是放弃其后的一切），随后通过 `agent.followup` 投递一条极简的插件来源触发消息启动重新生成（harness 没有"不追加就唤醒"的路径）。模型上下文里新文本只出现一次；旧内容留在日志里作审计。会话有运行中的轮次时，编辑先取消它（它在往将被遮蔽的区间里写）并等待落定——落定指被取消轮次的收尾全部落盘，而不是 `running` 翻转：翻转最先发生，被取消的工具结果在其后才落盘，`turn/end` 事件最后落盘，因此等待以该轮次的时间线位置关闭（turn/end 落盘）为准（有界；迟迟不落定的轮次会以「编辑失败」拒绝，绝不放行编辑去和收尾赛跑——那会把孤儿 tool 消息漏进模型上下文）。取消失败则不编辑。编辑不出现「已撤回」分隔线——插件的 edit Definition 把 replacement 认领为一条普通气泡行，带轻量「已编辑」徽标（可再次编辑形成编辑链：目标是上一个 replacement 的 seq)。编辑框底部 trailing 位带一个真实可用的模型 chip：它与 composer 的模型座位、/model 弹层共享同一个按会话的 `ModelDirectory`（经 `ctx.get('modelDirectories')` 读取——可选服务，组合里没有 ui-model-selection 时就不渲染 chip)，切换结果经 host 校验后作用于重新生成的轮次。

撤回是真撤回，不是打标记：host 追加一条 `user/message` surface replacement（与 compaction 同一机制），其区间覆盖目标消息及之后的所有 surface 节点，该区间由此离开 `session.surface`，不再进入模型上下文。replacement 事件携带 `source: { kind: 'plugin', plugin: 'message-tools' }`，其 `sourceEventSeqs` 引用每一个被遮蔽的节点，满足 surface 来源校验；方法返回前经 `SessionStore.flush` 落盘。本插件不引入任何新的 session 事件类型——harness 之外的事件类型无法携带 `ignorable: true`（envelope 由 append API 赋值），而持久化日志里的未知类型会让 session-persistence 在重载时拒绝整个日志。replacement 事件本身就是持久的审计轨迹。撤回成功后还会把目标消息原文自动回填到该会话 composer 草稿（与分隔线「重新编辑」同一条 `setDraft` 路径：空草稿直接填入、非空换行追加、composer 落 info 提示）——绝不自动发送，撤回失败则不回填；原位编辑路径不触发回填。

聊天投影同样从这条 replacement 事件获知撤回：插件的 Definition 把它认领为一条锚定在 replacement seq 上的分隔线节点。隐藏分两层：被遮蔽的用户渲染器对区间内的用户消息渲染为空；其余种类由 DOM 隐藏器覆盖——一张动态样式表把 `data-chat-flow-key`（`ChatNodeSeat.tsx`）锚点落在区间内的聊天行一律隐藏。隐藏器在首个非空规则集出现时探测这个未文档化属性，探测落空时进入有界重试（MutationObserver 等待首条聊天行出现，带截止时限）——页面停在轨迹页签或聊天区尚未挂载时不许一次定生死；只有重试窗口耗尽仍探不到行才自动停用并 `console.warn` 一次，退化为仅渲染器隐藏，且停用后 observer 仍然存活，聊天行晚到（例如页面在轨迹页签停过了窗口期）会自动恢复生效，绝不报错。分隔线采用官方 compaction 标记的视觉语言，可就地展开只读回放撤回区间（用户消息原文与助手文本，从实时节点存储折叠），并提供「恢复到对话末尾」操作（见下文的恢复）。撤回成功时原文已自动回填草稿（见上文的撤回段落），无需额外操作。

恢复是整个被撤回区间的尾部重放，不是原位修复：surface 折叠是位置性的——被替换的区间只接续成一个节点（`packages/core/session/src/surface.ts` 的 `applySurfacePlan`）——区间无法回到模型上下文原位。host 的 `restore` 方法沿着撤回 replacement 的 `sourceEventSeqs`（区间的权威边界，绝不重新推测）把每一条可重放内容按原始顺序逐条追加到尾部：用户消息逐字重放——编辑替换的内容就是最后一次编辑的新文本，因此恢复以编辑替换开头的区间时重放的是编辑后文本——每条助手回复的文本则以带框架的插件来源用户消息形式重放（`assistant/message` 无法携带插件来源，且 turn/step 轨迹不允许在 step 之外追加助手消息）。每条重放都在 `sourceEventSeqs` 里引用自己的原事件。工具调用/结果永不重放：调用/结果配对无法重新进入，副作用不可重放，且助手文本通常已概括了它们。重放出的行渲染为「已恢复」组——用户气泡带完整的复制/编辑/撤回操作行；助手回复以全宽行渲染，正文走官方 `MarkdownText`(ui-conversation 的 AssistantMarkdown 背后的公开渲染器，排版与代码块与原生回复一致），上方留小号 tertiary 色的「已恢复 · 助手回复」标注，模型侧框架文字不在 UI 上显示——分隔线在存在引用该区间的存活恢复行期间显示「已恢复」徽标；再次撤回这些恢复行会清掉徽标并重新启用恢复操作（恢复事件始终留在日志里）。

`/client` 导出插件本体（`apply`/`inject`）与 `MessageToolsRemote` 类型；host 侧导出 `MessageToolsService` 类，`/types` 子路径提供线上类型。

## 模型体验

### 编辑替换

#### 模型看到什么

编辑后，模型在原位置读到编辑后的文本，原消息之后的内容全部消失；其后跟一条极简的插件来源触发消息（`(用户编辑了上一条消息，请按编辑后的内容重新回答)`)，由它启动重新生成。新文本只出现一次。

#### Token 影响

一次编辑把被遮蔽区间的全部 token 从后续请求中移除，新增编辑后的消息和一条短触发消息。

#### KV Cache 影响

surface replacement 改写历史尾部，prompt 前缀从编辑点失效。

### 撤回替换

#### 模型看到什么

撤回后，模型不再看到被撤回的用户消息及其后的任何内容；对应位置的历史里只剩一条极简的插件来源用户消息：`(用户撤回了这条消息及其后的所有内容)`。

#### Token 影响

一次撤回会把被遮蔽区间的全部 token 从后续请求中移除，只新增一条很短的占位消息。

#### KV Cache 影响

surface replacement 改写了历史尾部，prompt 前缀从替换点开始失效——取舍与 compaction 相同，代价受撤回区间位置约束：撤回越早的消息，失效的缓存前缀越多；撤回最新消息则最少。

### 恢复重放

#### 模型看到什么

恢复把被撤回区间的可重放内容按原始顺序追加到尾部：每条用户消息逐字重放（被编辑的消息以其最后一次编辑的文本恢复），每条助手回复的文本带一行框架（`(以下是先前被撤回、现随恢复放回的助手回复)`)，全部为插件标记并引用各自的原事件。工具调用与结果不重放。被撤回区间本身保持隐藏。

#### Token 影响

一次恢复在尾部增加区间的可重放 token（用户消息加助手文本）；工具调用与结果的 token 不进入。

#### KV Cache 影响

不超出任何普通新用户消息的范围——尾部追加延展历史而不改写它。

## 兼容性

- npm 发布线(`@deepseek-ai/dsh@0.1.0-rc.6`):✅ 完整——已对发布 tarball 实测验证:`@deepseek-ai/dsh-session@0.1.0-rc.6` 导出 `./surface` 子路径(含 `isAppendSurfaceEvent` / `isReplacementSurfaceEvent`);其余运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery)。
- 源码线(deepseek-harness master):✅

## 已知限制与延后工作

- **全区间聊天隐藏依赖一个未文档化的 DOM 属性。** 投影层没有节点抑制 seam(分析见下条),因此隐藏工作在 DOM 层完成:一张动态样式表把 `data-chat-flow-key` 属性(`packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx:44-46`)锚点落在撤回区间内的所有聊天行一律隐藏,覆盖助手步骤、工具调用、turn 尾部等全部种类。隐藏器在首个非空规则集出现时探测该属性,探测落空先在有界窗口内重试(MutationObserver 等首条聊天行出现,带截止时限)——页面停在轨迹页签、聊天区尚未挂载时行一出现即恢复生效;若上游改名或移除,重试窗口耗尽后它自动停用并 `console.warn` 一次——失效形态是退化为旧行为(被遮蔽的用户消息仍由渲染器隐藏),绝不报错——且 observer 在停用后仍存活,行晚到会自动恢复隐藏而不是永久泄漏。行在分页时从节点存储重新挂载,隐藏规则随之重新生效;人工验证中未观察到与滚动锚定的相互影响。
- **为什么投影层做不到(彻底修复所需的上游 seam)。** 组装器对每个事件运行所有已注册 Definition 的 `match`,没有否决机制(`packages/client/runtime/src/client/sessions/conversation-assembler.ts:370`),且 `match(event)` 只能读当前事件(packages/client/AGENTS.md「Conversation Node discipline」);被遮蔽的事件在日志里仍保持原来的 `surfaceOp: 'append'`——replacement 的区间元数据只存在于 replacement 事件自身(`packages/core/session/src/types.ts:404-436`)——因此被遮蔽事件依然命中各内置 Definition(`conversation-nodes/message.ts:36-40` 与 `assistant.ts:247-250` 排除的是 *replacement* 事件,不是被遮蔽事件)。节点的 `visibility` 只能由产出它的 Definition 设置(`conversation-nodes/common.ts:56`),渲染序也只按它过滤(`chat-snapshot-builder.ts:135-139`);组装器禁止把已物化的节点撤回为 null(`conversation-assembler.ts:296-300`),节点 key 又与其 Definition 的 kind 绑定(`conversation-assembler.ts:707-718` + `contract/conversation.ts:272`),插件的 Definition 既无法翻转也无法冒充官方节点。遮蔽其余 `conversation.chat.node` key 同样行不通:官方组件没有导出,而 `command`、`turn-tail`、`tool-call` 条目声明了子槽位,遮蔽条目无法重复声明(`ui-slots/src/index.ts:829`)——其中 `tool-call` 还持有按工具名 keyed 的 `tool.call.toolview` 槽位(`ui-tool/src/client/apply.ts:23-31`),key 空间无界。host 侧如何写 replacement(区间、`sourceEventSeqs`)也无法改变这一点,因为聊天投影折叠的是日志而非 surface;官方 compaction 流水线在设计上就做了同样选择——被替换的区间保留在 transcript 里(`chat/CompactionItem.tsx:1-7`、`runtime/src/client/sessions/conversation.ts:206-212`)。
- **编辑仅支持文本。** 就地编辑框回填拼接后的文本块；原消息中的图片附件不会带入重发。
- **恢复是尾部重放，不是原位修复。** surface 折叠是位置性的——被替换的区间只接续成一个节点（`packages/core/session/src/surface.ts` 的 `applySurfacePlan`）——被撤回的区间无法回到模型上下文原位；`messageTools.restore` 把区间的用户消息与助手文本按原始顺序重放为尾部新消息（工具调用/结果除外：配对无法重新进入，副作用不可重放），分隔线保留并在恢复行存活期间显示「已恢复」徽标——再次撤回恢复行会清掉徽标并重新启用恢复操作。撤回的模型侧隐藏永不回退——区间始终留在 surface 之外。前驱实验的文件快照仍不在范围内。
- **恢复入口只在撤回分隔线上提供。** 编辑不产生分隔线（编辑气泡原位替换区间），因此纯编辑区间没有恢复入口；恢复包含编辑替换的撤回区间时重放的是最后一次编辑的新文本，恢复以编辑替换开头的区间（编辑气泡后被撤回）时，编辑后文本作为区间的第一条重放。
- **助手文本以带框架的用户角色消息重放。** `assistant/message` 无法携带插件来源（`AssistantMessage.source` 是 `ModelMessageSource`)，且会话轨迹要求助手追加必须有打开的 step(`packages/core/session/src/invariant.ts:118`)，因此重放的回复以插件来源用户消息落地、前缀框架 `(以下是先前被撤回、现随恢复放回的助手回复)`——角色保真由框架文字而非 role 字段承担。
- **分隔线展开回放读的是已物化的聊天节点。** 行已掉出加载窗口的区间显示「撤回的内容不在当前已加载的历史中」而非条目列表；模型侧的恢复重放不受影响（它折叠的是持久日志，不是节点存储）。
- **context 消息仍使用官方渲染器**，因此没有编辑/撤回操作；已吸入轮次的 steering 消息共享被遮蔽的渲染器，有同样的操作。撤回某条用户消息时，落在区间内的 steering 消息仍会随 surface 尾部一起对模型隐藏。仍在排队的消息不在本插件范围：它们还没落日志，官方队列条带已能经 `conversation.updateQueue` 编辑/移除它们。
