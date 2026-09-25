# @khorsheed/dsh-room

[English](README.md) | 中文

Room 将普通 DSH 会话变成有协调者和受邀成员的共享对话，使用公开插件服务和插槽，无需修改宿主源码。邀请第一位成员时，当前会话升级为 Room，原生 DSH agent 担任初始协调者。新 Room 将其命名为 `dsh`，已有 Room 保留日志中的寻址名称。

## 对话与协调

普通消息直接发送给当前协调者，初始为原生 DSH agent。邀请并准备好 DSH、Codex、Claude Code 或 Kimi 成员后，用户可以在成员页将其**设为协调者**。交接记录包含目标、成员名册和最近上下文。协调者正在运行时，必须等当前轮次结束才能替换。

开头的 `@name` 指向已有成员，多个名字并行派发。补全菜单不会创建成员；从菜单选择的名字即使位于句中也明确寻址，手写在普通正文中的提及则不寻址。同一成员的轮次共用 core 的整轮队列，不同成员可以并发。请求具有持久化身份，重试不会重复已接收的工作。

普通聊天不必建立正式计划。协调者可以用 `room_message` 派发小型后台任务，继续对话，并在轮次边界自动收到带关联标识的成果回报。外部成员通过家族认证桥使用 `room_read`、`room_invite`、`room_message` 和 `room_plan`。通过 `member_message` 或回答末尾 `@name` 发出的普通成员通知仍保留单独的人工确认/忽略入口；该入口不会阻塞协调者任务的成果回报。

## 目标与验收

较大工作由协调者或用户建立正式目标。目标面板展示阶段、层级任务、依赖、执行尝试、成果证据，以及明确的验收或返工。生成结束不等于验收通过；前置任务验收通过后，后续任务才有资格执行。返工记录原因，并在预算内开启新尝试。

预算限制整个目标的并发数、总执行次数、每项任务执行次数和目标推进时长（不含暂停时间）。首次执行、重试和返工均计入，普通聊天不消耗这些次数。用户可以暂停/继续、调整预算、检查证据、取消或结束已验收计划。重启后未确定的执行标记为待核对，计划暂停；必须提供证据核对，不能盲目重复执行。普通聊天任务与正式目标进度分别展示。

## 成员、模型与输出

成员页保留名称、provider、角色、工作目录、有效配置和会话入口。工作目录覆盖会传给家族委派接口，留空继承 Room 目录。成员跨轮次、跨重启保留原生会话。面包屑、任务入口和成员页仍能进入会话，查看工具、耗时和 token 用量。Room 原生会话统计不是所有成员消耗的总和。

协调者输入栏和成员输入栏使用同一套 core 模型/effort 控制。模型目录保留原生 ID、别名、显示名称及支持的推理选项；候选来源和完整性保留在目录合同中。共享选择器展示模型/强度、加载状态和影响操作的失败，不再提供目录维护控件。运行中选择新配置会排到下一完整轮次，工具续跑仍沿用本轮配置；core 统一持有当前/待生效状态、版本、撤销和重试。冻结评测成员拒绝配置变更。原生 DSH 主会话仍使用宿主模型选择器及其语义，不属于 local-agent 成员控制器。

Live 成员把原生正文和推理增量同时呈现在成员会话和 Room 中，最终消息与工具记录仍为权威内容。定向停止只中断该成员，非空部分输出带明确的停止/失败标记、耗时和成员会话入口保留。Room 长回答可从紧凑预览展开。通道间隔本身不证明 P95 延迟达标，实测验收单独记录。

## 安装

```sh
dsh plugin add @khorsheed/dsh-room
```

本包自行挂载 loader 行和浏览器贡献。使用外部成员时，同时安装 local-agent core 和所需 provider。原生 DSH 面向模型的工具由 `@khorsheed/dsh-room-tool` companion 提供，通过会话 preset composition 授权。邀请入口和成员标签页跟随该授权，无法读取 inventory 时保持可见，已有 Room 始终保留入口。卸载移除本插件的界面。

## Compatibility

- npm 宿主线（`@deepseek-ai/dsh@0.1.5-rc.1`）：支持——0.1.5-rc.1 全量 boot 实证通过（42 包含 capture，2026-09-25）——在本次 local-agent 家族发布并安装前降级。目前尚未发布的家族实现是外部协调者准备、共享控制和认证成员工具的前提；缺失时这些操作返回不可用，原生 DSH Room 功能仍可用。
- 源码宿主线（deepseek-harness `183f08e9c6`，`0.1.5-rc.1`）：worktree 组合构建及隔离 preflight 通过，已实测 DSH/Kimi 协调者、委派、两阶段验收和中断恢复。候选 tarball 在上述 npm 宿主上的全新安装与升级也已通过，旧 Room 状态得到保留。Codex/Claude 认证运行与完整延迟门槛仍待验收，见[验收记录](../../docs/acceptance/room-coordinator-2026-09-19.md)。
- 源码宿主线（deepseek-harness master，`0.1.7-rc.1`）：✅ 构建测试全绿（`verifiedHost: 0.1.7-rc.1`）——Session V4 适配：主代理 followup 的 source 改为生产者归属 kind `room`（V4 原生准入在落盘写入时拒收退役的 `kind: 'plugin'` 包装；0.1.5 宿主的 `user/message` 准入只查 kind 非空，两条线都能落盘），读侧兼认 `room`、`plugin:@khorsheed/dsh-room`（V3→V4 迁移形态）与 V3 包装存量。`conversation.chat.node` rc.1 契约复验通过（5 个 room 渲染器均不触 hookContext 与 disclosure 工厂）。
- 双线证据：0.1.5 的 boot 经三层兼容修复端到端通过——[preset-registry 双名探测](../../.agents/notes/implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md)、[typert codec 双形状](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md)、[face 自带 zod@4](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md)。

Room 通过当前 loader 的会话事件目录注册 `room/*`，保证重启后能够读取持久化日志；core 同样注册成员流式检查点。已持久化的 Room 需要继续挂载 Room 插件。这是等待官方事件注册 API 的临时兼容接口。

## 限制

普通成员通知仍需人工确认。原生 DSH 会话的换模轮次语义由宿主决定。远程宿主绘制测量需要对齐时钟，本地诊断假设同钟。成员标识和操作按钮复用了宿主样式，需要跟进上游视觉变化。存储失败提供诊断，模型回答成功不能排除存储故障。
