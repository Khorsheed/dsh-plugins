# Agent Note: message-tools 以社区 seam 实现编辑/撤回

Status: implemented

[English](2026-08-15-message-tools-edit-withdraw.md) | 中文

## Problem

仓库之外的社区 message-tools 实验为用户消息提供了编辑与撤回，但数据链从未接通：keyed slot 条目注入的是硬编码占位 props；host 半部分只 `ctx.provide('messageTools')` 而没有注册任何 Remote，浏览器侧根本调不到；「撤回」只是追加一个 ignorable 标记事件，原消息仍留在模型上下文里。重写必须完全走公开 seam：不得改动官方包。

## Decision

插件落在 `packages/message-tools`(`@khorsheed/dsh-client-message-tools`)，单包双 face(host + client，沿用 api/remotes 的分离 tsconfig 模式）。

- **撤回即 surface replacement。** host 的 `MessageToolsService extends TypertRemoteService` 暴露 `@Remote('withdraw')`：校验目标（仍在 live surface 上的 append-surface 用户消息）后追加一条 `user/message`,`surfaceOp: { op: 'replace', start, end }` 覆盖目标及整个 surface 尾部，`sourceEventSeqs` 引用每个被遮蔽节点，`source: { kind: 'plugin', plugin: 'message-tools' }`，随后 flush。模型侧通过与 compaction 相同的机制被完全隐藏。
- **不引入新的 session 事件类型。** `Session.append` 自行赋 envelope，无法设置 `ignorable: true`；不在 `KNOWN_SESSION_EVENT_TYPES` 里的持久化事件类型会让 session-persistence 在重载时拒绝整个日志。replacement 事件本身就是审计轨迹。这取代了实验版的 `user/message/withdrawn` 标记事件。
- **客户端自行挂载 Remote。** 沿用 ui-file-preview：客户端 apply 里 await `ctx.remote.$mount(messageToolsRemote)` 挂载生成的 `/remote` contribution，再以 `ctx.get('remote.messageTools')` 读回命名空间（放进 `inject` 会让 loader 死锁）。无需修改 `dsh-api-remotes`。
- **UI 组合遵循 slot 标准。** 用户消息渲染器经 `ctx.slots.inject('conversation.chat.node', ...)` 以 priority -1 遮蔽 key `user`;`message-tools-withdrawn` Definition（经声明合并进 `ChatNodeDataMap`）把 replacement 事件认领为分隔线节点；渲染器通过 `useSession` + `shallowEqual` 把分隔线折叠为隐藏区间，落在区间内的用户消息渲染为 null。编辑 = 先撤回再经按作用域寻址的 conversation 服务 `send`。复制使用正确的复制图标；撤回对话框按 `RiskConfirmation` 真实的调用方持有 `acknowledged` 状态接线；所有文案走插件自有 locale 命名空间。

## Verification

单元测试覆盖撤回规划折叠（区间、尾部与全部拒绝码）、replacement 谓词、分隔线 Definition 与隐藏区间折叠。两个聚合的 `tsc -b`、本包 vitest、oxlint、翻译配对门禁全部通过。在 3080 实例上，打出的 tarball 启动无插件错误，气泡显示真实文本与操作行，并在一条测试会话上端到端验证了编辑与撤回。

## Alternatives considered

**沿用实验版追加 `user/message/withdrawn` 标记事件。** 它把消息留在模型上下文里（不是真撤回），且由于无法设置 `ignorable`，任何没有本插件类型的 harness 在重载后都读不了这条日志。

**通过遮蔽全部 13 个 `conversation.chat.node` key 来隐藏区间内所有节点。** 组装器对每个事件运行所有 Definition 的 `match`，没有否决（`packages/client/runtime/src/client/sessions/conversation-assembler.ts:370`);`match(event)` 只能读当前事件，而被遮蔽事件在日志里仍是 `surfaceOp: 'append'`——内置 Definition(`conversation-nodes/message.ts:36-40`、`assistant.ts:247-250`）排除的是 replacement 事件，不是被遮蔽事件。节点 `visibility` 由产出它的 Definition 独有（`conversation-nodes/common.ts:56`；渲染序过滤在 `chat-snapshot-builder.ts:135-139`)，组装器禁止把已物化节点撤回为 null(`conversation-assembler.ts:296-300`)，节点 key 与 Definition 的 kind 绑定（`conversation-assembler.ts:707-718` + `contract/conversation.ts:272`)，插件 Definition 既无法翻转也无法冒充官方节点。keyed 遮蔽无法委托给被遮蔽条目，而 `command`、`turn-tail`、`tool-call` 条目声明了子槽位，遮蔽条目无法重复声明（`ui-slots/src/index.ts:829`;`tool-call` 还持有无界的按工具名 `tool.call.toolview` key 空间，`ui-tool/src/client/apply.ts:23-31`)。host 侧怎么写 replacement 都无法改变这些，因为聊天投影折叠的是日志而非 surface——compaction 被遮蔽区间按设计保留在 transcript 里也是同理（`chat/CompactionItem.tsx:1-7`、`runtime/src/client/sessions/conversation.ts:206-212`)。否决：隐藏范围限定在插件自有渲染器，以分隔线标记位置。

**手写客户端 Remote contribution 并依赖网关 SRC fallback。** 可以省掉生成的 `/typert` + `/remote` 工件，但失去严格的 zod 边界校验，还要手工维护一种生成格式。生成器路径是受支持的契约，代价只是一个 host-face tsconfig。

## Follow-up：模型 chip 与全区间 DOM 隐藏

同一包的第二轮迭代，两处新增：

- **编辑框的 trailing 位渲染真实模型 chip。** 读写都经 `ctx.get('modelDirectories')`——ui-model-selection 的按会话共享 `ModelDirectory`，与 composer 模型座位、/model 弹层用的是同一份 store——因此编辑框里的切换经 host 校验，作用于重发的消息。该服务用 `ctx.get` 读取、绝不声明为 inject 边，组合里没有 ui-model-selection 时退化为不渲染 chip（以一个冻结的空 stub observable 保持 hooks 舱形状），而不是让 loader 空等。子 agent 会话按官方同款可用性规则不提供 chip。
- **全区间聊天隐藏移到 DOM 层。** 上文的投影分析依然成立——没有可用 seam——因此客户端安装一张动态样式表，把 `data-chat-flow-key` 属性（`ChatNodeSeat.tsx:44-46`）锚点落在撤回区间内的所有聊天行一律隐藏，覆盖全部节点种类。隐藏器只跟踪当前选中的会话（flow key 跨会话会撞），仅在区间集合或节点数变化时重写规则，并随插件 fiber 释放。该属性未文档化，因此隐藏器在首个非空规则集出现时延后一帧探测（等 React 提交）；探测不到就自动停用、`console.warn` 一次，行为退回第一版（用户消息仍由被遮蔽的渲染器隐藏）。分隔线自身的 kind 不参与规则生成。

## Follow-up：恢复、分隔线重做为可展开标记、undo 图标

第三轮迭代，四处新增：

- **撤回/恢复使用本包自绘的 undo 箭头图标**(`src/client/icons.tsx`,`fill="currentColor"` 路径、官方 16×16 outline 约定）:ui-primitives 没有 undo/revert 类图标，其 refresh 图标的语义是重载。
- **分隔线重做**为 compaction 标记的视觉语言（弱化的可点击行 + chevron)，带从实时节点存储推导的「已撤回 N 条消息」计数，可就地展开只读回放区间内容（用户原文 + 助手文本，在展开事件处理器里折叠——渲染代码订阅、事件处理器读快照），并提供恢复操作。
- **恢复是尾部重放。** surface 折叠是位置性的——被替换区间只接续成一个节点（`packages/core/session/src/surface.ts` 的 `applySurfacePlan`)——被撤回的助手步骤永远无法回到模型上下文原位。host 的 `messageTools.restore` Remote 把被撤回用户消息的内容逐字追加为新的插件标记 `user/message`(`sourceEventSeqs` 引用原事件），模型视其为最新用户消息。第二个 Definition 把恢复事件（append + 插件标记）认领为带「已恢复」标签的气泡行；分隔线从引用其区间首个 seq 的恢复行推导「已恢复」徽标。DOM 隐藏器无需改动：恢复行的 anchorSeq 落在所有撤回区间之外。
- **操作行数值对齐官方 MessageIconActions**(10px 间距；28px 正圆按钮，tertiary → secondary hover)。

## Follow-up：rotate-ccw 图标、编辑先取消运行轮、steering 影子

第四轮迭代，三处改动：

- **undo 图标改为 rotate-ccw 圆形回转箭头**（近整圆弧线 + 拐角箭头，`stroke="currentColor"`,16×16)——直 undo 箭头观感不佳；撤回操作与恢复徽标共用。
- **编辑现在先取消运行中的轮次再重发**(`src/client/edit-resend.ts`)：运行中的回复必然落在撤回区间内，不取消的话重发会排队或插队进旧轮。`editResend` 在撤回落地后读 `snapshot.running`，仅在运行时经按作用域寻址的 `conversation.cancel()` 取消；取消失败则不发送并拒绝。单元测试钉住顺序（撤回→取消→发送）、空闲路径（不取消）与两条失败路径。
- **影子注册扩展到 `steering` key**（上游本就同一个渲染器注册 `user` 与 `steering` 两个 key,`register-node-renderers.ts:17-19`)：已吸入轮次的 steering 消息就是 append surface 的用户消息，编辑/撤回语义一致。仍在排队的消息无需本插件：官方队列条带已经能经 `conversation.updateQueue`(`{ kind: 'edit' | 'remove' }`）编辑/移除，且它们未落日志，surface 机制不适用。影子整个 queue dock 的方案评估后否决——官方 UI 已存在，属重复造轮子。

## Follow-up：编辑重定义为原位替换

第五轮迭代：按产品拍板重定义编辑语义（编辑是修正，撤回是撤销）。

- **编辑改为单步原位替换。** host 的 `messageTools.edit` Remote 追加一条内容即编辑后文本的 `user/message` replacement——无占位、无分隔线、无尾部重复。[目标..surface 尾部] 的区间仍遮蔽其后的一切（编辑即放弃后续）,DOM 隐藏器按撤回同款方式隐藏区间旧行（编辑气泡行携带 `{ seq, hiddenStartSeq }`，折叠进同一套隐藏区间）。
- **重新生成由 `agent.followup` 携带极简插件触发消息启动。** 调查确认 harness 没有"不追加就唤醒"的路径（`agent.ts` 在轮次开始时认领并 append；空认领批次不产生模型调用）:`followup`/`steer`/`prompt` 都会 append，没有任何东西监听普通 append。触发消息（`op: 'edit-trigger'`）只落一次——编辑文本仍只在 replacement 里出现一次。它的 context 行由 DOM 隐藏器按 `op` 隐藏（与 restore 去重规则并列）。
- **编辑链与取消。** 运行中的轮次先取消并（有界）等待落定，使其收尾写入落在被遮蔽区间内；取消失败则不编辑。编辑后的气泡可再次编辑——上一个 replacement 的 seq 是合法目标（`planEdit` 接受 surface 上的编辑 replacement)。
- **标记。** 插件 source 增加 `op` 判别字段（`'edit'` | `'edit-trigger'`)；无 `op` 的存量事件按撤回/恢复解读，旧会话回放不变。

## Follow-up：整段恢复重放与再次撤回

第六轮迭代，两处改动：

- **恢复按原始顺序重放整个被撤回区间。** `planRestore` 从撤回 replacement 的 `sourceEventSeqs` 解析区间（绝不重新推测），折叠成重放条目：用户来源消息与编辑替换（其内容即最后一次编辑的新文本）逐字重放为用户消息；助手回复以带框架的插件来源用户消息重放（op `restore-assistant`，框架 `(以下是先前被撤回、现随恢复放回的助手回复)`)——因为 `assistant/message` 无法携带插件来源（`AssistantMessage.source` 是 `ModelMessageSource`）且会话轨迹要求助手追加必须有打开的 step(`packages/core/session/src/invariant.ts:118`)；工具调用/结果、撤回占位与编辑触发消息永不重放（调用/结果配对无法重新进入，副作用不可重放，助手文本通常已概括）。host 把各条目逐条追加到尾部，各自在 `sourceEventSeqs` 引用原 seq。客户端投影为「已恢复」组：用户气泡走共享的遮蔽渲染器（带复制/编辑/撤回操作行），助手文本行是新 kind `message-tools-restored-assistant`。编辑×恢复组合语义：恢复包含或以编辑替换开头的区间时重放最后一次编辑的新文本；纯编辑区间没有分隔线，因此没有恢复入口。
- **恢复行与编辑行可再次撤回、再次编辑。** `planWithdrawal`/`planEdit` 接受恢复重放行作为目标（编辑替换此前已接受）——此前恢复行的插件来源过不了 user 来源检查，恢复过的内容永远无法再撤回。分隔线的「已恢复」徽标现在追踪存活的恢复行：再次撤回恢复行会把它们藏进新区间、清掉徽标并重新启用分隔线的恢复操作；恢复事件始终留在日志里作为审计轨迹。

## Follow-up:「重新编辑」草稿回填与 pack-dist 脚本

第七轮迭代，两处改动：

- **撤回分隔线新增「重新编辑」操作**：把区间内第一条被撤回用户消息的原文（经 `collectWithdrawnEntries` 从实时节点存储折叠，取第一个 `user` 条目——平铺区间的后续条目不涉及，不做多选）回填到会话 composer 草稿：`conversation.input.for(actx).setDraft` 是唯一公开的草稿写入路径（`packages/client/ui-conversation/src/client/input/contract.ts:74`)，空草稿直接填入、非空草稿换行追加（`src/client/backfill.ts` 的 `mergedDraft`)，并经同一门面在 composer 上落一条 info 提示。它绝不自动发送——用户编辑后走官方发送管线发出一条与撤回历史解耦的全新普通消息。官方没有现成的 composer 焦点 API，因此只填草稿。
- **dist 打包 rescope 自动化**(`scripts/pack-dist.ts` + 规格）：暂存拷贝、清单改写（名称/版本、`workspace:^` → 源版本 caret、去掉 repo 专用字段）、`cordis.patch.yml` 与所有运行时 `.js` 工件里的自包名改写（含 typert manifest 的归属名）、会让打包失败曝响的 `lib/types` 陈旧产物检查，以及打包前对两个关键名称的验证——上一轮漏掉它们分别导致插件静默不加载和启动死循环。

## Follow-up：恢复的助手行复用官方 markdown 渲染器

第八轮迭代，仅表现层:「已恢复 · 助手回复」行的正文从纯文本 `MessageText` 换成官方 `MarkdownText`(ui-primitives 公开导出；ui-conversation 的 `AssistantMarkdown` 即用它渲染），恢复出的回复与原生助手回复排版一致（正文、代码块、列表），行去掉 525px 气泡宽度上限、与原生回复一样全宽。标注保留为小号 tertiary 色；不加操作行（组内用户气泡已带复制）。模型侧框架前缀现在只在模型上下文出现，UI 展示时剥离（marker.ts 的 `stripRestoreAssistantFrame`，在 Definition 里应用）——第七轮整段重放以来它一直漏进了 transcript 行。

## Follow-up：撤回后自动回填草稿

第九轮迭代：撤回成功后自动把目标消息原文回填到会话 composer 草稿——常见路径不再需要点「重新编辑」。编排逻辑（`src/client/withdraw-backfill.ts` 的 `withdrawAndBackfill`,stub 动词单测）只在撤回落地后回填、空文本（纯图片消息）跳过、失败绝不回填；原位编辑路径不触发回填。两个调用点（遮蔽渲染器的撤回确认、分隔线的「重新编辑」——保留以覆盖草稿已被清空/改过的边角）共享 apply 里的同一个 `backfill(sessionId, text)` 闭包——即上一轮的 `conversation.input.for(actx).setDraft` + `mergedDraft` + info 提示链路。

## Follow-up：债务清理——拆重新编辑、回放折叠修复、覆盖率

第十轮迭代，四项：

- **拆掉「重新编辑」。** 撤回自动回填后按钮冗余；展开区保留只读回放与恢复操作。`withdrawn.reedit`/`reeditFilled` 两个 key 删除；自动回填的提示文案落在 `withdrawn.backfilled`。
- **分隔线回放折叠读错了助手数据形状。** `collectWithdrawnEntries` 原来找 type 键的 `finalNode.blocks`；真实的 assistant-step 数据是 kind 键（`data.blocks`，落定后 `finalNode.blocks`——`conversation-nodes/assistant.ts`)，导致助手条目从不出现。修复为 `joinAssistantText` 并按真实形状补了回归测试。窗口边界仍在：掉出加载窗口的行不显示（「撤回的内容不在当前已加载的历史中」)。
- **覆盖率债务清零：本包 src 达到逐文件 100%**（语句/分支/函数/行）。新增：UserMessageView 与 ModelChip 组件测试（jsdom,stub 选择器 hook)、WithdrawnDividerView/RestoredMessageView/icons/locales 测试、apply 组合测试（真实 cordis Context + SlotRegistry + LocaleRuntime + stub Remote 命名空间）、host REAL-composition 测试（真实 SessionStore 插件 + 本包服务插件，withdraw/restore/edit 走真实 surface 折叠）、invariant 伴生测试。保留 4 处有理由的 `v8 ignore`（必然参与匹配的正则组、ref 守卫、禁用按钮守卫、永不为空的重放回执）。
- **lockfile 收录本包**:registry 可达后跑 `pnpm install` 记录了 importer 与新增的 `dsh-client-test-runtime` devDependency；前几轮手工补的 node_modules 符号链接被正规链接取代。

## Consequences

profile 只需增加一行 cordis 配置（`id: message-tools` + 包名）即可安装本插件；该行指向的包必须已构建（host lib、typert 工件与 client bundle)。撤回后，该区间对之后每一轮的模型都不可见；transcript 里区间内的用户消息消失并出现分隔线，而区间内的助手与工具行在上游抑制 seam 出现之前仍然可见。撤回可通过尾部重放区间的可重放内容（用户消息与助手文本；工具调用除外）逆转，重放出的行本身也可再次编辑或撤回。
