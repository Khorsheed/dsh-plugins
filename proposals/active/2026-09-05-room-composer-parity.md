# room 输入框与官方输入机全面对齐（room-composer-parity）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-05
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`(含 archived)。最近邻:room 设计 note(2026-08-18-room-multi-agent-conversation,其 L157「composer 接管=继承全部环境职责」只列了 todo 条/排队条/Stop/pending 让出——正是本提案要补的缺口)、`local-agent-member-channel`(可写 composer)、`local-agent-member-dispatch-reliability`(本提案的兄弟提案,派发可靠/流式/排队态,不涉及输入面)。无既有 composer 对齐意图,新建。
- **官方依赖**：纯插件。宿主输入机(`useInput` / `inputActions` / `conversation.input.for(sessionId)`)与 `conversation.input.*`/`conversation.composer.dock` 坑位均官方已暴露,room 只在自己包内把这层接上。零 harness 改动。

## 目标

让 room 会话的输入框(现为 `@khorsheed/dsh-room` 的 `RoomComposer` 接管)**与官方 InputBar 能力一致**——官方自带 + 社区插件叠加的能力,在 room 里一个不少。保留 room 特有的 @ 成员寻址菜单与 dock 双胶囊/任务条/统计行。

## 现状(实测 + 代码)

**根因**：`RoomComposer`(packages/room/src/client/RoomComposer.tsx)持有自己的 `const [draft, setDraft] = useState('')`,**只接入宿主输入机 `inputActions` 的写入面**(且仅用于裸消息放行进官方提交路径),**不读宿主输入机状态**(`useInput` / `conversation.input.for(sessionId).state`),也不渲染官方 `conversation.input.*` 坑位。官方 InputBar(`input/InputBar.tsx`)则以 `useInput(s=>s)` 读输入机状态、把草稿/occurrences/imageIds/phase 当唯一真源,并 `renderSlot` 诸输入坑位。

因此**凡是绑定宿主输入机或官方输入坑位的能力,在 room 里全部丢失**。设计 note(L157)「接管=继承全部环境职责」只兑现了一部分(todo 条/排队条/Stop/pending 让出),下述均未兑现。

### 能力差矩阵

| 能力 | 官方 InputBar | RoomComposer | 丢失原因 |
|---|---|---|---|
| 草稿来源 | `useInput(s=>s).draft`(输入机为真源) | 本地 `useState('')` | 不读输入机 |
| 草稿持久化/恢复 | `storedDraft` 经 `inputActions.setDraft` 回填(ConversationSession L189) | 无 | 不订阅机器草稿 |
| 撤回回填输入框 | message-tools `backfillDraft` → `conversation.input.for(sid).setDraft`(index.ts L97-105) | 丢失(写进隐藏的官方机器,room 不读) | 不读机器草稿 |
| 撤销/重做(Ctrl/Cmd-Z/Y) | 输入机 undo/redo 日志(InputBar L394-403) | 无 | 不走输入机 |
| 斜杠命令 + claim | `toggleCommandMenu`、adjudication、space、Escape 分层 | 无(只有 `@` 成员菜单) | 不走输入机/命令面 |
| 引用 chips / occurrences | 输入机 `occurrences`,backdrop 装饰、copy/cut 展开、Backspace 删 chip、paste-upgrade | 无 | 不读输入机 |
| 图片/附件 | `imageIds`/`draftImages`/`addImages`/`removeImage`/`pruneImages`、drop、尺寸预检 Toast | 无 | 不读输入机/不渲染 attachments 坑位 |
| 粘贴(文件+文本,chip 升级) | `onPaste` → paste-begin + intake | 无 | 不走输入机 |
| 触发子系统(mention/slash/reference) | `keyboard.track/arbitrate/space/dismissPopup` | 仅自定义 `@` 成员菜单 | 不走输入触发 |
| IME 组合输入 | `onCompositionStart/End` + composing 守卫 | 无(组合态 Enter 会误发送) | 缺 IME 守卫 |
| busy-Enter 提交(排队/steer) | `resolveSubmitMode` + `steerQueue` + `canSteerQueue` | 简单 Send/Stop 切换(running 标志) | 不走提交机 |
| 通知/Toast(promptError、附件拒绝、notices) | `useNotices` + `Toast` + promptError | 仅行内 error | 缺通知层 |
| 权限/模型座位 | `conversation.input.plan` / `conversation.input.model` / `PermissionSelect`(Access) | 无 | 不渲染官方输入坑位 |
| ContextMeter | `useProjection` 上下文用量(InputBar L795) | 无(room 自绘 RoomStatsLine) | 缺此 seat |
| 输入坑位(attachments/plan/model/overlay/dock/left/right/footer) | `renderSlot` | 部分 re-home(todo/queue/stats),其余丢失 | 只 re-home 了设计 note 列的几种 |
| 占位/禁态(removed/inert/blocked/parent-offline/plan/goal) | 丰富(InputBar L747-756) | 单一占位 | 缺状态机 |
| DOM 细节(滚动窗/镜层/悬灯 reveal/滚轮链/Safari 修复/自动聚焦) | 完整(InputBar L198-310) | 简单 auto-height | 缺实现 |

### 插件叠加但被丢的能力

- message-tools:**撤回回填输入框**(已修,见上)、**编辑在席**(`editInPlace`,走 `conversation.cancel()`,room 主 agent cancel 语义待核)。
- ui-shortcuts:busy-Enter 行为、键盘。
- ui-model-selection:编辑器的模型切换 chip。
- ui-permission-presets:Access 权限 chip。
- ui-attachment / 图片摄入。
- ui-input-trigger:斜杠/提及/引用/chip 粘贴升级、space 裁决。
- ui-plan:`plan` 投影占位与提示。

## 方案

**方向:让 RoomComposer 落回宿主输入机,只把 room 特有的部分叠上去。**

- 用 `useInput(s => s)` 读机器草稿(`draft`/`occurrences`/`imageIds`/`phase`/`queue`)当唯一真源,输入经 `inputActions.setDraft` 写回;@ 成员菜单的 `@` 检测读机器草稿 + caret(现有逻辑可平移)。
- room 独有部分保持在输入机之上:@ 成员菜单 `picked`、dock 双胶囊、任务条、统计行、RoomQueueStrip——它们是额外 decoration/dock,不替代输入机。
- 逐项把上表补回:斜杠命令、references、附件、粘贴、IME、busy-Enter 排队/steer、通知层、权限/模型座位、ContextMeter、`conversation.input.*` 坑位 re-home、占位/禁态、DOM 滚动/reveal。
- 与宿主输入机对齐后,message-tools 的撤回回填/编辑在席、ui-shortcuts、ui-model-selection 等**自动恢复**,无需各插件为 room 特判。

> 也可反向评估:room 是否根本不值得接管 composer,而是作为**官方 composer 的行为增强**(chain 上低优先级读取/挂件)叠加——但 room 的 @ 寻址与 dock 接管需要替换官方提交目标,故大概率仍需接管;接管时以上述对齐为准。

## 里程碑

- **M1**：RoomComposer 落回输入机(读草稿/occurrences/imageIds/phase,输入写回),@ 菜单平移。撤回回填、草稿持久化、undo/redo 先恢复。
- **M2**：补齐输入坑位 re-home(attachments/plan/model/overlay)、通知层、IME、busy-Enter 排队/steer、ContextMeter、占位/禁态。
- **M3**：斜杠命令、references、粘贴 chip、DOM 滚动/reveal 等余下项。

## 实现记录

(实施时登记:相关 Agent Note / PR / 包名;建议交叉引用 note 2026-08-18-room-multi-agent-conversation L157 与提案 local-agent-member-dispatch-reliability)

## 验收标准(done 判定,绑定可插拔交付)

- `@khorsheed/dsh-room` 独立包内完成,`dsh plugin add / remove` 可装卸,零 harness 改动。
- 在 room 会话实测:撤回后原文回填输入框、Ctrl/Cmd-Z 撤销、斜杠命令、图片/附件、粘贴文本与图片、busy 时 Enter 排队、模型/权限座位、ContextMeter 均与普通会话一致。
- @ 成员寻址、dock 双胶囊、任务条、统计行在 room 行为不变。
- 包内测试 + 家族测试全绿;`check:plugins` / `check:hygiene` 通过。

## 风险 / 放弃的东西

- 把 RoomComposer 落回输入机会**放大改动面**(这是当前最大重构),且 room 提交目标与官方不同(@ 派发走 room Remote,裸/排队走官方 input 机),需小心区分两条提交路径。
- 不完整的接管会**静默藏掉官方面**(设计 note 已警示):对齐必须逐项验收,不能只做视觉对齐。
- room 特有 `@` 菜单的 caret 依赖输入机 caret(输入机不暴露 caret,需 DOM `selectionStart` 维持)。
- 现阶段不扩大:不重构 composer 为通用组件、不动宿主;仅 room 自包内对齐。
