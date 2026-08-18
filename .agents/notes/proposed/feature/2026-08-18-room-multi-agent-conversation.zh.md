# Agent Note: Room——多 agent 群聊会话

Status: proposed

[English](2026-08-18-room-multi-agent-conversation.md) | 中文

## Problem

如今让多个 agent 协作完成一个任务，没有好的形态。主 agent 是强制中转：人对 local-agent CLI 成员（kimi / claude-code / codex）说的每句话都要经过主 agent 的 subagent 工具，每个回答也原路返回。另一条路是人在多个独立会话之间来回穿梭、手工搬运上下文。两种形态里，协调——谁知道什么、谁在等谁——都发生在人脑里，而不是产品里。

宿主已经暴露了所需的全部原语（`ctx.sessions` 原生 `parentSession`、`ctx.subagents.start`、local-agent 家族的 resume 注册表、`agent.followup`/`inject`、可合并扩展的自定义会话事件，以及客户端的 `conversation.composer` / `conversationEvents` / `conversation.chat.node` slot）。缺的只是把它们组合成群聊形态。约束是硬性的：不动上游（`deepseek-harness`）——room 必须完全用官方能力加我们自己包的改动来构建。

## Proposal

新包（暂名 `@khorsheed/dsh-room`）。**room 是一个被标记为 room 的普通 dsh 会话，它的标准聊天界面承载若干平等 agent，用 @ 提及来寻址。** 一阶段人是中央枢纽；人等价于中介拿掉之后的 agent 对 agent 对话是后续阶段，等枢纽模式跑顺再做。

### 会话与成员模型

- 创建 room（`+ 新会话` 旁边加 `+ 新 room`）就是创建一个普通会话并 append 一条 `room/created` 自定义事件。该事件是 room 的身份标记，也是其日志的根——名册、派发记录、黑板都是这个会话上的自定义会话事件，持久化和重开 replay 都是免费的。
- 成员一律平等；**@ 是唯一触发器**。会话自己的主 agent 也是无特权成员——不被 @ 就什么都不感知、什么都不说。
- 外部成员（如 `@ada`）是 local-agent 家族 CLI provider 的委派：一个 dsh 子会话（`parentSession = room 会话`），通过家族 resume 注册表跨轮延续（`kimi -S` / `claude --resume` / `codex exec resume`）。每个成员保持自己私有的 CLI 上下文；子会话里的镜像 transcript 是完整轨迹，官方 UI 可直接查看。

### 派发与路由

- 一个 `conversation.composer` chain 贡献解析输入：`@名字 ...` 派发给该成员（多个 @ 各自分发）；裸消息只记录到黑板、不触发任何 agent（UI 给轻提示）；主 agent 也只能像其他成员一样被 @ 才响应。composer 的 @ 菜单**只列已有成员**——纯寻址，不承担邀请。
- 向 CLI 成员派发走 local-agent 委派门面（`ctx.localAgent.start` / `.resume` / `.cancel`，由 `proposals/active/2026-08-18-local-agent-delegation-api.md` 交付）；room 的 CLI 成员路径收敛在一个 adapter 接口后面，门面落地 main 之前整体缺席——`ctx.get('localAgent')` 探针加方法存在性检查，保证 room 的任何中间 commit 在没有门面的 main 上也是绿的。主 agent 不在环路里。运行是异步的：一个成员在跑时人可以 @ 另一个；同一成员的派发串行（家族 resume 锁保证每个子会话同时只有一个 in-flight resume），不同成员天然并行。

### 黑板——共享层

- room 维护一份共享对话记录（黑板），作为 room 会话上的自定义事件：人类消息、派发记录、成员的最终回复。
- 每次向成员派发时，在 prompt 文本里携带黑板（一阶段：自该成员上次被派发以来的条目；之后做窗口/摘要策略）。这就是 `@bill 基于 ada 的 API 出方案` 不需要人搬运上下文就能工作的原因——共享视野的所有者是 room，不是人。
- 黑板对人可见、派发时带给成员，但**默认对主 agent 的模型视角不可见**（自定义事件不进 `deriveMessages()`）。主 agent 能从它看得到的人类消息里的 @ 提及推断名册，但看不到成员回复。如果实际使用中这种"失忆"太严重，合规的升级路径是可 opt-in 的 `agent.inject` 静默旁听（不唤醒）——绝不把成员产出写成模型可见的 `user/message` 事件。

### UI：成员发言、运行中状态、边界事件

官方聊天设计语言（已对 harness 的 `ui-conversation` 核实）：assistant 发言**没有气泡也没有卡片**——纯全列宽 markdown；元信息走 14px 三级灰 hover 行（`MessageIconActions`）；非对话节点（工具调用、命令、思考、compaction 标记）收敛为 24px `DisclosureRow`；且不画硬分隔线。room 留在这套语言之内——**多角色身份由身份行承载，而不是卡片**。

- **成员发言节点** = 身份行 + 无框正文 + 操作行：
  - *身份行*：16px 成员色圆点 + 成员名胶囊（复用官方 `.refChip` 造型——用户气泡里 `@subagent` 提及就渲染成它）+ provider 名三级灰字。色点是唯一的新视觉词汇，每个成员一个固定色。
  - *正文*：官方 `MarkdownText` 全列宽 markdown，与主 agent 发言排版完全同构。
  - *操作行*：用 CSS Modules 复刻 `MessageIconActions` 的 chrome，图标用 `dsh-client-ui-primitives` 里同一批 16px 图标——**复制**、**会话跳转**（进成员子会话）、诚实的**耗时**（派发→settle）、hover 淡入的**时间戳**。刻意缺席：**分支/fork**（`forkAt` fork 的是 *room* 会话——对名册、黑板、resume 锁的语义未定义）和 **TPS/TTFT**（CLI 进程一轮没有令牌流，假造数字不如没有）。核实的 harness 版本里官方集合是 复制/分支/runMs/TTFT/TPS/hover 时间戳——没有点赞/点踩。
- **运行中状态** = 与 ToolRow 同构的 24px disclosure 行（StateDot + `ada 正在工作… · 12s` + 扫光动画，带 `prefers-reduced-motion` 兜底；M3 的 transcript 增量落地后行尾跟截断摘要）。**整行是跳转子会话的链接**，行尾停止按钮接 `localAgent.cancel`。M3 之前跳过去只能看到 descriptor/turn-start（无害）；增量镜像落地后跳过去就是实时施工现场——这个动线一阶段就上，体验随里程碑自动变好。
- **边界事件**（成员加入/离开、邀请记录）= compaction 标记式 dim 单行。message-tools 的 `WithdrawnDividerView` 是验证过的社区模板。
- **工程约定**：CSS Modules + 只用 `--dsw-alias-*` 语义 token（每个 var 带 fallback 链；暗色免费，零 JS 主题逻辑），primitives 用 `dsh-client-ui-primitives`，节点布局交给官方 `.flowItem` 的 16px 列节奏，不自加背景、边框、分隔线。早期草案里的"引用"按钮砍掉——黑板已经会把成员产出带给下一个被 @ 的人，人自己的指代需求复制粘贴就够。

### 成员管理：成员 tab 与邀请

- room 会话的视图导航（对话/轨迹那一排）上用 `conversation.view` slot 增加**成员 tab**，标题 `成员 (N)`。成员相关的一切收在这里：名册行（色点、名字、provider、状态 + 耗时，行级 `[编辑]` `[轨迹→]`，运行中显示 `[中断]`）和邀请入口。这取代了早期的两个草案——header 头像叠放和 composer-@ 邀请都砍掉；名册一处管到底。
- **邀请弹窗**（从 tab 的 `＋ 邀请成员` 进入）：provider 选择（候选来自 `ctx.localAgent.roster()`，未登录的置灰并给登录引导）、显示名、角色指令、可选的首个任务。确认即写名册事件——填了首个任务则立即发 fresh 委派（角色指令拼在 prompt 前）；留空则成员入列待命。
- **角色指令机制，实话实说**：家族 CLI provider 是 `cli -p` 一次性进程，没有 system prompt 通道。room 把角色指令拼进首轮派发的 prompt 最前面——经 resume 链留在成员自己的 CLI 会话里，效果等价——后续编辑则作为一条上下文更新随下一次派发带入（`你的角色指令更新为：…`）。主 agent 成员不配角色指令，它保持会话自己的设定。
- **主 agent 邀请**：room 在 room 会话里注册模型工具 `room_invite({ provider, name, instructions, firstTask? })`。人用自然语言交代（"请个后端工程师进来负责 API"），主 agent 自己定 provider、自己写角色指令、自己起名字（ada/bill/cathy 风格）；调用落到与弹窗相同的 room 服务 invite 函数，产出完全一样的成员记录。命名规则：room 内唯一、不含空白和 `@`（composer 的 @ 解析必须可工作）、显示名与 provider 解耦（`ada (kimi-cli)`），同一个 provider 的两个实例可以共存。成员行可标注来源（由你邀请 / 由主 agent 邀请）；成员 tab 的"编辑"对人写的和 agent 写的指令一视同仁。

### 成员互 @（一阶段：人工确认）

- 成员回复里出现 `@其他成员` 时在投影路径上检测，作为待派发卡片呈现在黑板上（`[确认] [忽略]`）；只有人确认才触发转派。带轮次预算的自动级联推迟到用法验证之后。这个接缝就是日后真正的 agent 对 agent 对话（比如 room 所有者直接向受邀进 room 的 local-agent 管理员成员提需求）在人不再是枢纽之后的落点。

### 对 local-agent 的需求（已提交；已被 `proposals/active/2026-08-18-local-agent-delegation-api.md` 接受立项）

> **场景**：room 插件让人**直接**跟 local-agent CLI 成员对话，不经主 agent 中转。目前代表用户行事的插件想延续某个成员的 CLI 会话，只能重新实现家族的内部 intent staging 协议。
>
> **请求**：(1) `ctx.localAgent` 上的公开 continue API，封装归属校验、resume intent staging、每子会话 resume 锁——家族提案按 room 侧评审意见定名 `resume`（避开 `continue` 保留字）；(2) 运行进度可见性（先心跳，后 transcript 增量）；(3) 非工具调用方可用的中断入口。
>
> **需要保持的约束**：父会话归属校验、resume 句柄绝不进 prompt 文本、每子会话同时只有一个 in-flight resume。
>
> **远期**：人等价于中央枢纽的模式跑顺之后，agent 对 agent 对话建立在同一套 API 之上。

里程碑耦合（room 侧）：门面的 **M1** 解锁 CLI 成员派发（此前 room 在自己 worktree 里做脚手架、黑板、UI、主 agent 成员路径，零依赖）；**M2** 心跳把"已派发"升级为"工作中…计时"；**M3** 让运行中行的跳转能看到实时输出；**M4**（委派映射持久化）解锁跨重启续跑。

## Alternatives considered

### Why not 成员对话继续走主 agent 中转（现状）？

那正是要逃离的形态：每条消息都要为一个会改写、会遗忘、还烧 token 的模型中转付费，而且人永远无法直接对成员说话。所有权模型（锚在 `parentSession` 上的委派记录）本来就允许直接派发，中转买不到任何东西。

### Why not 官方 continuable subagent API（`startContinuable` / `followup` / `reportFrom`）？

语义上它几乎就是 room 的成员模型，但没有任何生产 provider 实现 `prepareContinuable`——所有 shipped provider 都是 `backgroundMode: one-shot`，家族 CLI provider 跑的是自己的 resume 机制。依赖它等于在一条没被踩过的接缝上盖楼；家族 resume 注册表才是经过实战的路径。

### Why not 用独立 room 视图（`conversation.view` tab）做合并时间线？

早期草案在自定义 view tab 里渲染合并时间线。时间线方案已否决：room 就是这个会话本身，标准聊天界面已经提供输入框、markdown 渲染和滚动回溯；投影事件 + `conversation.chat.node` 渲染器能在它内部实现多 agent 合并展示，表面积小得多，也不 fork UI。自定义输入框同理被否，改用官方 `conversation.composer` chain slot。（这个 slot 仍然被使用——给成员 tab，那是管理界面，不是第二条时间线。）

### Why not 成员发言用带边框的卡片？

带边框/底色的卡片与官方语言冲突：assistant 发言是无框全列宽 markdown，元信息走三级灰 hover 行，代码库明令不画硬分隔线。身份行（色点 + `.refChip` 名胶囊）只用官方视觉词汇就实现了多角色区分。

### Why not 通过 composer 的 @ 菜单邀请？

邀请需要填名字和角色指令——这是表单的活，不是一个按键。composer 的 @ 菜单保持纯寻址（只列已有成员）；邀请收在成员 tab 的弹窗和主 agent 的 `room_invite` 工具里。

### Why not 把成员产出写成 room 会话里模型可见的事件？

那样主 agent 能"免费"感知成员活动，但代价是被迫全程旁听：上下文灌水，而且主 agent 可能对成员产出自作主张接话。默认必须是零感知；真需要时 `agent.inject` 才是有分寸的升级。

### Why not 在 session-store 层面做新的会话类型？

会话 header schema 是官方且固定的；一条 `room/created` 自定义事件就能提供同等身份与 replay 语义，无需改动宿主。

## Acceptance criteria

- `+ 新 room` 创建流程产出一个以 room 形态打开的会话（重开时从 `room/created` 事件恢复身份）；视图导航出现 `成员 (N)` tab。
- 邀请弹窗：provider 列表反映 `localAgent.roster()` 的登录态；填首个任务确认即开工，留空则入列待命；角色指令可在子会话首轮里验证确实拼在最前。
- 主 agent 的 `room_invite` 工具产出完全相同的成员记录（agent 自选名字与指令）；重名或含 `@`/空白的名字以工具错误拒绝。
- `@ada <任务>` 跨轮延续同一条 CLI 会话（子会话 transcript 验证 resume）；裸消息只记黑板、不触发任何 agent；两个成员并行运行，对同一成员的两次派发串行。
- 成员发言渲染为身份行（色点 + 名胶囊 + provider）+ 无框 markdown + 操作行（复制、会话跳转、耗时、hover 时间戳）；无分支、无 TPS；运行中行可跳转子会话、行尾停止按钮可中断；进出事件渲染为 dim 单行。仅靠 alias token 即暗色正确。
- 向成员派发时携带自该成员上次派发以来的黑板条目；主 agent 的 `deriveMessages()` 历史里没有任何成员产出。
- 重开 room 会话后，身份、名册、黑板从事件 replay 恢复。
- 包可独立安装、运行、卸载；未挂载 local-agent provider 时 room 仍可用（主 agent 是唯一成员）；任何中间 commit 在没有 local-agent 门面的 main 上也是绿的（adapter 探针）。

## Risks

- **轮次延迟、无流式**：成员每轮是一个完整 CLI 进程生命周期；进度渲染搭 local-agent 里程碑的车（M2 心跳、M3 增量），此前降级为朴素运行中行。
- **上下文成本随成员数放大**：每次派发都把黑板复制进每个成员的私有 CLI 上下文；长 room、多成员会成倍放大 token 成本。后续需要窗口/摘要策略。
- **未验证的接缝**：非 agent 调用方传 `ctx.subagents.start` 的 `parent` 形态（已吸收进 local-agent 门面，经 `ctx.agents.get` 解析）；`conversation.composer` chain 语义；`conversation.chat.node` 对我们节点类型的覆盖度；`conversation.view` tab 注册。动工前先写 spike 验证。
- **复刻内部 chrome**：`.refChip`、`MessageIconActions`、`DisclosureRow` 不是导出的插件 API，我们复刻其样式。上游视觉漂移是维护税——属装饰层、可接受，但用截图文档钉住现状。
- **成员互 @ 的歧义**：行文中提到 vs 真正的派发请求无法机械区分；一阶段人工确认能兜住，但解析规则需要打磨。
- **跨包依赖**：room 的 CLI 成员路径依赖 local-agent 门面（M1）；adapter 保证 room 没有它也是绿的，但招牌能力要等 M1 合并才能交付。
