# @khorsheed/dsh-room

[English](README.en.md) | 中文

一个会话，一整队 agent——把 DSH、Kimi、Codex、Claude Code 邀请进来，@ 名字派活；协调者拆目标、成员交证据，验收还是人说了算。

让多个 agent 干同一件事，过去只能在几个窗口之间复制粘贴，或者靠一次性的子代理调用——返回即遗忘。Room 把会话本身变成共享的协作场所：邀请第一位成员，当前会话就升级为 Room，原生 DSH agent 入座初始协调者；每位成员跨轮次、跨重启都保留自己的原生会话。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="640" alt="一个进行中的 Room:聊天流里的成员回执与运行行,输入框上方展开的 @ 成员菜单">

## 特性

- **邀请即升级**——没有单独的「创建房间」步骤：在任意会话里邀请第一位成员，它就变成 Room；原生 DSH agent 入座初始协调者（新 Room 命名为 `dsh`，已有 Room 保留日志里记录的寻址名）。
- **@ 寻址与并行派发**——开头的 `@name` 指向已有成员，多个名字并行派发；从补全菜单选中的提及即使位于句中也明确寻址，手写在正文里的提及则不算（菜单永不创建成员）。同一成员的轮次共用一条队列，不同成员并发执行；请求带持久化身份，重试不会重复已接受的工作。
- **协调者交接**——任何准备好的成员（DSH、Codex、Claude Code、Kimi）都可以在成员页「设为协调者」；交接记录携带目标、计划状态、未结任务和最近上下文。协调者运行中时，必须等当前轮次落定才能替换。
- **后台委派、回报自动对账**——普通聊天不必建立正式计划：协调者用 `room_message` 派发小型后台任务，在轮次边界自动收到带关联标识的成果回报。成员之间的普通通知（`member_message`、回答末尾的 `@name`）仍走人工确认/忽略闸门——该闸门从不阻塞协调者任务回报。
- **耐久目标计划与证据验收**——较大工作建立正式目标：阶段、层级任务、依赖、执行尝试、提交的证据，以及明确的验收或返工。生成结束不等于验收通过；前置任务验收后，后续任务才有资格执行。预算约束整个目标的并发数、总执行次数、每项任务执行次数和目标推进时长（不含暂停时间）；暂停、继续、调整预算、取消与完成都是人的指令。重启后未确定的执行标记为待核对、计划暂停——核对必须提供证据，绝不盲目重跑。
- **成员保留原生会话**——成员页记录名称、provider、角色、工作目录覆盖（留空继承 Room 目录）、有效配置与会话入口；面包屑与任务入口能进入成员自己的会话，查看工具、耗时与 token 用量。Room 原生会话的统计不是所有成员消耗的总和。
- **共享模型/强度控制**——协调者与成员输入栏共用同一套 core 模型/effort 控制；运行中选择新配置会排到下一完整轮次（工具续跑沿用本轮配置），冻结的评测成员拒绝变更。原生 DSH 主会话仍使用宿主模型选择器及其语义——它不是 local-agent 成员控制器。
- **实时输出与定向停止**——成员把原生正文与推理增量同时呈现在自己的会话和 Room 中；最终消息与工具记录仍是权威内容。定向停止只中断该成员，非空部分输出带明确的停止/失败标记、耗时与会话入口保留；长回答可从紧凑预览展开。
- **入口随 preset 授权显隐、失败放行**——「邀请 agent」chip 与「成员」tab 只在当前会话的 preset 组合授予 `@khorsheed/dsh-room-tool` 行时出现；读不到组合时保持可见（fail-open）；已是 Room 的会话始终保留界面。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="640" alt="成员标签页：空态的「把会话变成多 agent 协作间」与会话头部的「邀请 agent」入口">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="640" alt="成员页：成员卡片（名称、provider、角色、模型）与「设为协调者」操作">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-room
```

本包自行挂载 loader 行与浏览器贡献；重启 web 实例后生效。需要外部 CLI 成员时，同时安装 local-agent core 和所需 provider——没有它们，Room 仍可与原生 DSH 协调者正常协作。面向模型的工具（`room_invite` / `room_task` / `room_message`）由伴生包 `@khorsheed/dsh-room-tool` 提供，按会话 preset 授权。

```sh
dsh plugin --profile web remove @khorsheed/dsh-room
```

卸载移除本插件的全部界面；已持久化的 Room 日志保留在各自会话日志中。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 支持、带一处设计内降级——0.1.5-rc.1 全量 boot 实证通过（42 包含 capture，2026-09-25），经三层兼容修复（[preset-registry 双名探测](../../.agents/notes/implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md)、[typert codec 双形状](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md)、[face 自带 zod@4](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md)）；`minHost` 钉在 0.1.5-rc.1。外部成员依赖 local-agent 家族（core + provider），该家族尚未发布到 npm：缺失时成员准备、共享模型/强度控制与认证成员工具返回不可用，原生 DSH Room 功能保持完整。候选 tarball 在 npm 宿主上的全新安装与升级检查通过，旧 Room 状态得到保留。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.7-rc.2——也是 3080 生产实证线）——Session V4 适配：主 agent followup 的 source 改为生产者归属 kind `room`（V4 原生准入在落盘写入时拒收退役的 `kind: 'plugin'` 包装；0.1.5 宿主的 `user/message` 准入只查 kind 非空，两条线都能落盘），读侧兼认 `room`、`plugin:@khorsheed/dsh-room`（V3→V4 迁移形态）与 V3 包装存量。`conversation.chat.node` rc.1 契约复验通过（5 个 room 渲染器均不触 hookContext 与 disclosure 工厂）。DSH/Kimi 协调者、委派、两阶段验收与中断恢复已端到端实测——见[验收记录](../../docs/acceptance/room-coordinator-2026-09-19.md)。

## 已知限制

- **成员间通知仍需人工确认**——`member_message` 转发与回答末尾的 `@name` 先落 pending 日志，等人确认或忽略；只有协调者任务回报不经过这道闸门。
- **外部成员依赖 local-agent 家族**——家族发布并安装之前，CLI 成员准备、共享控制与认证成员工具降级为不可用（邀请时返回结构化 `local-agent-unavailable`，派发落 `failed` 运行记录）；原生 DSH 成员不受影响。
- **Codex/Claude 运行验收仍待完成**——DSH 与 Kimi 成员已端到端实测；Codex/Claude 认证运行尚未验收，完整 P95 流式门槛也未关闭——通道间隔本身证明不了 P95 延迟。
- **已持久化的 Room 需要保持挂载本插件**——`room/*` 事件词汇表由插件注册进会话事件目录（等待官方注册 API 的临时 seam），未挂载的构建按设计拒读该日志。
- **成员标识与操作样式复用宿主视觉**——跟随宿主 chrome，上游视觉变化时需要跟进复验。
- **跨宿主绘制测量假设同钟**——本地诊断假设共享时钟；远程宿主的测量需要对齐时钟。
- **模型回答成功不能排除存储故障**——持久化失败以诊断形式呈现。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** 宿主半部分是 `RoomService`——一个 Typert Remote 服务（以 `room` 提供），掌管升级、名册管理、人类 @ 入口、通知闸门、任务板与运行取消；派发记录与首个任务由 `DispatchEngine` 执行，耐久目标由 `PlanService` 负责（每个房间一条串行写者）。房间的全部状态就是会话的 `room/*` 自定义事件日志——纯日志事件：持久化与重载回放免费获得，模型永远看不到，未挂载本插件的宿主也能安全回放该会话。每次读取把日志经纯函数回放折出状态，每次写入追加并落盘。冷读取（`isRoom`/`getState`）经持久化检视回答，不唤醒 agent；对冷房间的写入先按日志记录的 preset 冷恢复 agent。`agent/pre-step` 守卫防止过期的客户端或其他输入面在外部协调者背后唤醒 DSH 模型：原生轮次必须携带明确的 room 来源派发，用户输入改走房间入口路由，无法无损转发时直接拒绝。

**事件词汇 seam。** 插件在 apply 时把 `room/*` 类型注册进会话持久化的事件目录。注册必须落在工具链的模块实例里——profile 安装的插件否则会解析出第二份目录副本，重启后读路径会拒读 room 日志——因此 specifier 在运行时拼出并解析，顶层 await 让插件加载器阻塞 boot 直到注册完成。这是等待官方事件注册 API 的临时 seam。

**客户端。** 浏览器半经 `ctx.remote.$mount` 挂载生成的 Remote，注册 zh/en 词典，并驱动客户端 `RoomStore`。槽位条目：会话头部「邀请 agent」动作（`conversation.session.header.actions`，order 30）、「成员」`conversation.view` tab（order 20；隐藏发生在注册层——隐藏的 tab 是注销而非空体）、`conversation.composer` 接管（priority -10：只认领缓存判定为 Room 的会话，对挂起的审批交互让位；dock 胶囊与统计行由它自行渲染，因为它们的官方座位随被藏起的回退树一起消失），以及五个 `conversation.chat.node` 渲染器（`room-speech` / `room-run` / `room-event` / `room-relay` / `room-task-line`）。

**工具行拆分（M4'）。** core 不在 profile 根注册任何面向模型的工具：`room_invite` / `room_task` / `room_message` 的工厂留在 `./tool` 且不带 origin 标签；伴生包 `@khorsheed/dsh-room-tool` 把工具行挂进 agent preset 组合（按会话授予）并打上自己的 origin 标签。`room_invite` 与 `room_message` 会把调用所在会话升级为 Room；`room_task` 与胶囊 UI 走同一组宿主函数写共享任务板。外部成员经认证家族桥（`receiveMemberCommand`）使用 `room_read` / `room_invite` / `room_message` / `room_plan`——房间与调用者身份由宿主持有，绝不出现在工具参数里。

**家族耦合。** 与 local-agent 家族唯一的耦合是探测式门面——`ctx.get('localAgent')` 加方法存在性鸭子类型判断，类型仅作 type-only 导入、编译期漂移检查。门面缺席时 CLI 成员降级（邀请返回结构化 `local-agent-unavailable`，派发落 `failed` 运行记录），绝不影响 boot。通知闸门的 `receiveMemberMessage` 由家族桥鸭子调用，跨无类型包边界做运行时校验。

**模型体验。** 当前目标随每个成员提示词的名册段顶部下发；刻意不做黑板折叠——成员提示词从不消费房间的运行日志（speech/dispatch 事件只为 UI 投影与回放落日志）。面向模型的工具随会话 preset 授予到达，由伴生包打标。

**身份三角。** cordis 行 id `room`（`cordis.patch.yml`）= `clientBundle('@khorsheed/dsh-room')`（`tsdown.config.ts`）= `src/invariant.ts` 的 `PACKAGE_NAME`。导出：`.` 宿主服务、`/client`（插件 `apply`/`inject` 与 `RoomRemote` 类型）、`/tool` 工具工厂、`/types`、`/typert`、`/remote`、`/invariant`。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/room`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
