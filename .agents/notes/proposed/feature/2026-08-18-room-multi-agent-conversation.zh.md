# Agent Note: Room——多 agent 群聊会话

Status: proposed

[English](2026-08-18-room-multi-agent-conversation.md) | 中文

## Problem

如今让多个 agent 协作完成一个任务，没有好的形态。主 agent 是强制中转：人对 local-agent CLI 成员（kimi / claude-code / codex）说的每句话都要经过主 agent 的 subagent 工具，每个回答也原路返回。另一条路是人在多个独立会话之间来回穿梭、手工搬运上下文。两种形态里，协调——谁知道什么、谁在等谁——都发生在人脑里，而不是产品里。

宿主已经暴露了所需的全部原语（`ctx.sessions` 原生 `parentSession`、`ctx.subagents.start`、local-agent 家族的 resume 注册表、`agent.followup`/`inject`、可合并扩展的自定义会话事件，以及客户端的 `conversation.composer` / `conversationEvents` / `conversation.chat.node` / `conversation.input.dock` slot）。缺的只是把它们组合成群聊形态。约束是硬性的：不动上游（`deepseek-harness`）——room 必须完全用官方能力加我们自己包的改动来构建。

## Proposal

新包（暂名 `@khorsheed/dsh-room`）。**room 是一个被标记为 room 的普通 dsh 会话，它的标准聊天界面承载若干平等 agent，用 @ 提及来寻址。** 一阶段人是中央枢纽；人等价于中介拿掉之后的 agent 对 agent 对话是后续阶段，等枢纽模式跑顺再做。

### 会话与成员模型

- 创建 room（`sidebar.footer.action` 里的 `+ 新 room` 入口）就是创建一个普通会话并 append 一条 `room/created` 自定义事件——它是 room 的身份标记，也是其日志的根。名册、派发记录、发言投影、任务板都是这个会话上的自定义会话事件，持久化和重开 replay 都是免费的（事件类型在 apply 时登记进持久化目录——目录问题的来龙去脉见已实现的那篇 bug-fix note）。
- 会话自己的主 agent 是无特权成员。**不带 @ 的消息就是跟主 agent 的正常对话**（composer 放行给官方提交路径）；**@ 是派发触发器**。主 agent 因此天然感知人的非派发消息（它们是普通 `user/message` 事件），对成员发言零感知。
- 外部成员（如 `@ada`）是 local-agent 家族 CLI provider 的委派：一个 dsh 子会话（`parentSession = room 会话`），通过家族 resume 注册表跨轮延续。每个成员保持自己私有的 CLI 上下文；子会话里的镜像 transcript 是完整轨迹。
- **成员级 `cwd`**：成员合法地可能与 room 会话在不同工作目录干活（主 agent 在仓库 A，CLI 成员在仓库 B）。邀请弹窗带 cwd 字段（缺省继承 room 会话的 cwd）；投递需要门面层的覆盖参数（下方需求 R2）。

### 派发与路由

- 一个 `conversation.composer` chain 贡献解析输入：以 `@名字` token 开头的文本派发给这些成员（多个 @ 各自分发）；**其余原样放行给官方 composer 行为**（正常的主 agent 回合）。composer 的 @ 菜单只列已有成员——纯寻址，不承担邀请。
- 向 CLI 成员派发走 local-agent 委派门面（`ctx.localAgent.start` / `.resume` / `.cancel`）；room 的 CLI 成员路径收敛在一个 adapter 接口后面，门面缺席时整体降级——`ctx.get('localAgent')` 探针加方法存在性检查，room 只带主 agent 成员也能装能跑。主 agent 不在派发环路里。运行是异步的：同一成员的派发串行（家族 resume 锁保证每个子会话同时只有一个 in-flight resume），不同成员天然并行。

### 成员上下文：名册 + 通知（无环境流水账，无全景）

没有黑板，成员也不感知 room 全文。早期草案每次派发都携带滚动流水账摘要，已砍——上下文成本随成员数二次方膨胀，而且机械搬运一切不如发送方写的一封精准通知。每次派发的 prompt 只携带三样：

1. **名册**：成员名、provider、一句话角色——成员能 @ 谁的前提仅仅是知道谁存在，不需要知道别人在干什么。
2. **通知**：寻址到该成员的待收通知（见下）。
3. 本次派发文本。

协调知识不靠注入，靠消息本身携带："@ada 设计 API，做完告诉 bill" 里"做完告诉 bill"是任务文本的一部分，ada 把它记进**自己的**行动清单（子会话里它自己的 todo，R3 镜像），做完后按通知协议输出；room 的机制只负责送达。成员自己的私有 CLI 上下文（resume 链）持有它的工作记忆；room 绝不重发它已见过的历史。

### 任务板——协调工件

- room 维护一块**持久任务板**：每成员的任务及状态（`pending` / `in_progress` / `done` / `cancelled`）。由 journal 驱动（`room/task-*` 自定义事件），与其他一切一样跨重载 replay 恢复。
- **人的管理面**：渲染在 room 会话的 `conversation.input.dock` slot（官方给"输入框上方独占一行"留的缝——与官方 todo 条同一坑位形态），按成员分组。人可以在上面添加、调整优先级、改派、关闭任务。**任务板只是人的管理视图，不进任何成员的 prompt**——成员间的协调靠消息携带与通知协议，不靠全景注入。
- **不用 `todo/write`**：官方 todo 面板是 agent 的每轮工作计划，下一个 `turn/start` 即清空——持久的多成员任务板不能寄生这个语义。任务进板来自派发（@ 派发开任务；成员的完成发言闭任务）和人的显式编辑。
- **成员自己的 todo 留在各自会话里**：CLI 成员内部的 todo 清单由家族镜像进其子会话（需求 R3），在那里的官方 todo 条上原生渲染，互不干扰。

### 通知：成员间转派（一阶段：人工确认）

- **主通道（桥接）**：local-agent 家族的 member-channel 提案（`proposals/active/2026-08-19-local-agent-member-channel.md`）给成员 CLI 注入桥接 MCP 工具 `member_message(to, text)`（每 run 一次性 token 鉴权、host 侧同父校验）——结构化工具调用，run 中途即可发，身份不可伪造。
- **闸门交接**：家族 bridge 投递前探测 `ctx.get('room')`；父会话是 room 时不直发，调 room 的接收方法 `room.receiveMemberMessage({ from, to, content, parentSessionId, provenance })`，由 room 判定归属并按闸门配置决定**待确认卡**还是**自动派发**；room 缺席或父会话非 room，家族直发。闸门所有权单一归于 room。
- **回执透传**：闸门结果（`sent` / `pending-confirm` / `busy`）经桥接返回给发送方成员，让它的结论诚实（"已通知，待房间主人确认" ≠ "已送达"）。
- **降级通道（文本解析）**：桥接缺席时（旧版本家族、非家族成员），room 检出成员回复**末尾独占行**的 `@名字 <内容>` 作为待转派（该格式写进名册注入，行文中"提到"与"通知"机械可区分）。
- 待转派记录进 journal（`from`、`to`、`content`、出处），聊天流渲染为确认行（`[确认派发] [忽略]`）；确认后投递为收件人续轮的 prompt（`ada 给你的通知: …`）。
- 二期把闸门调成 `auto` 并加级联预算（每条人类消息最多 N 轮转派、禁止无正文变化的往复、预算耗尽降级回确认）。

### UI：成员发言、运行中状态、边界事件

官方聊天设计语言（已对 harness 的 `ui-conversation` 核实）：assistant 发言**没有气泡也没有卡片**——纯全列宽 markdown；元信息走 14px 三级灰 hover 行（`MessageIconActions`）；非对话节点收敛为 24px `DisclosureRow`；且不画硬分隔线。room 留在这套语言之内——**多角色身份由身份行承载，而不是卡片**。

- **成员发言节点** = 身份行 + 无框正文 + 操作行：
  - *身份行*：16px 成员色圆点 + 成员名胶囊（复用官方 `.refChip` 造型——用户气泡里 `@subagent` 提及就渲染成它）+ provider 名三级灰字。色点是唯一的新视觉词汇，每个成员一个固定色。
  - *正文*：官方 `MarkdownText` 全列宽 markdown，与主 agent 发言排版完全同构。
  - *操作行*：用 CSS Modules 复刻 `MessageIconActions` 的 chrome，图标用 `dsh-client-ui-primitives` 里同一批 16px 图标——**复制**、**会话跳转**（进成员子会话）、诚实的**耗时**（派发→settle）、hover 淡入的**时间戳**。刻意缺席：**分支/fork**（`forkAt` fork 的是 *room* 会话——对名册与 resume 锁的语义未定义）和 **TPS/TTFT**（CLI 进程一轮没有令牌流，假造数字不如没有）。核实的 harness 版本里官方集合是 复制/分支/runMs/TTFT/TPS/hover 时间戳——没有点赞/点踩。
- **运行中状态** = 与 ToolRow 同构的 24px disclosure 行（StateDot + `ada 正在工作… · 12s` + 扫光动画，带 `prefers-reduced-motion` 兜底；家族的实时 transcript 镜像给行尾跟截断摘要）。**整行是跳转子会话的链接**，行尾停止按钮接 `localAgent.cancel`。
- **边界事件**（成员加入/离开、转派记录）= compaction 标记式 dim 单行。message-tools 的 `WithdrawnDividerView` 是验证过的社区模板。
- **工程约定**：CSS Modules + 只用 `--dsw-alias-*` 语义 token（每个 var 带 fallback 链；暗色免费），primitives 用 `dsh-client-ui-primitives`，节点布局交给官方 `.flowItem` 的 16px 列节奏，不自加背景、边框、分隔线。

### 成员管理：成员 tab 与邀请

- room 会话的视图导航（对话/轨迹那一排）上用 `conversation.view` slot 增加**成员 tab**。它是纯成员管理：名册行（色点、名字、provider/harness、模型——能拿到才显示，CLI 成员的模型在它 scoped home 的配置里、可能不上报，则不显示——角色指令、状态 + 耗时，行级 `[编辑]` `[轨迹→]`，运行中 `[中断]`，`[移除]`）和邀请入口。任务不在这里——任务在 dock 任务板。
- **邀请弹窗**：provider 选择（候选来自 `ctx.localAgent.roster()`，未登录的置灰并给登录引导）、显示名、角色指令、**cwd**（缺省继承 room 会话的）、可选的首个任务。确认即写名册事件——填了首个任务则立即发 fresh 委派（角色指令拼在 prompt 前）；留空则成员入列待命。
- **角色指令机制，实话实说**：家族 CLI provider 是 `cli -p` 一次性进程，没有 system prompt 通道。room 把角色指令拼进首轮派发的 prompt 最前面——经 resume 链留在成员自己的 CLI 会话里，效果等价——后续编辑则作为一条上下文更新随下一次派发带入（`你的角色指令更新为：…`）。主 agent 成员不配角色指令，它保持会话自己的设定。
- **主 agent 邀请**：room 在 room 会话里注册模型工具 `room_invite({ provider, name, instructions, firstTask?, cwd? })`。人用自然语言交代（"请个后端工程师进来负责 API"），主 agent 自己定 provider、自己写角色指令、自己起名字（ada/bill/cathy 风格）；调用落到与弹窗相同的 room 服务 invite 函数，产出完全一样的成员记录。命名规则：room 内唯一、不含空白和 `@`（composer 的 @ 解析必须可工作）、显示名与 provider 解耦（`ada (kimi-cli)`），同一个 provider 的两个实例可以共存。

### 对 local-agent 的需求

委派门面（`start` / `resume` / `cancel`、reattach 配方、进度事件、`delegations.jsonl` 持久化——提案 `proposals/active/2026-08-18-local-agent-delegation-api.md`，M1–M4）**已交付并验收**。三条新需求，已提交家族评估：

> **R1——双向成员通道**：~~实现官方 continuable 接口~~——经家族评审否决（`prepareContinuable` 只返回种子数据，continuation manager 自行创建进程内 dsh Agent，与 CLI 无关；官方 README 亦留白 host-user continuation），**已由 member-channel 提案承接**：可写 composer（chain priority 遮蔽只读接管）+ `promptMember`/`stopMember` Remote + 桥接 MCP 成员互通知。room 侧配合点：暴露 `receiveMemberMessage` 闸门入口（见「通知」一节）；R1 不再向 continuable 方向提需求。
>
> **R2——单次调用 cwd 覆盖**：`DelegationCallOptions` 加 `cwd?: string`，provider 优先于 `parent.session.header.cwd` 使用。room 成员合法地在不同目录工作。
>
> **R3——todo 状态镜像**：CLI 成员使用自己的 todo/计划功能时，把状态镜像为子会话的 `todo/write` 事件，成员自己的会话里官方 todo 条原生呈现其计划。

## Alternatives considered

### Why not 成员对话继续走主 agent 中转（现状）？

那正是要逃离的形态：每条消息都要为一个会改写、会遗忘、还烧 token 的模型中转付费，而且人永远无法直接对成员说话。所有权模型（锚在 `parentSession` 上的委派记录）本来就允许直接派发，中转买不到任何东西。

### Why not 官方 continuable subagent API（`startContinuable` / `followup` / `reportFrom`）？

语义上它几乎就是 room 的成员模型，但没有任何生产 provider 实现 `prepareContinuable`——所有 shipped provider 都是 `backgroundMode: one-shot`，家族 CLI provider 跑的是自己的 resume 机制。resume 注册表是经过实战的路径；家族采纳 continuable 接口（需求 R1）作为升级跟踪，不作依赖。

### Why not 黑板（每次派发注入滚动流水账摘要）？

第一版设计。评审后砍掉：上下文成本随成员数二次方膨胀；一切延迟到接收方下次被叫醒；且决定性的一点——发送方知道接收方需要什么，它写的通知胜过机械搬运一切。名册注入保住了寻址的唯一前提（知道谁存在），定向通知负责带内容；任务板只是人的管理视图，不进成员 prompt。journal 事件保留作 UI 投影与 replay——没有删任何东西，只删了一种消费方式。

### Why not 任务板建在官方 `todo/write` 机制上？

官方 todo 面板是 agent 的每轮工作计划，下一个 `turn/start` 即清空——持久的多成员任务板会被主 agent 的下一回合抹掉，且与平铺单会话语义相抵。任务板复用同一**坑位形态**（输入框上方的 `conversation.input.dock` 条）但用自己的 journal 驱动数据。成员自己的 todo 仍以真 `todo/write` 镜像进子会话（需求 R3），官方条原生渲染。

### Why not 用独立 room 视图（`conversation.view` tab）做合并时间线？

room 就是这个会话本身；标准聊天界面已经提供输入框、markdown 渲染和滚动回溯；投影事件 + `conversation.chat.node` 渲染器在它内部实现多 agent 合并展示，表面积小得多，也不 fork UI。（view slot 仍然被使用——给成员 tab，那是管理界面，不是第二条时间线。）

### Why not 成员发言用带边框的卡片？

带边框/底色的卡片与官方语言冲突：assistant 发言是无框全列宽 markdown，元信息走三级灰 hover 行，代码库明令不画硬分隔线。身份行（色点 + `.refChip` 名胶囊）只用官方视觉词汇就实现了多角色区分。

### Why not 通过 composer 的 @ 菜单邀请？

邀请需要填名字、角色指令和 cwd——这是表单的活，不是一个按键。composer 的 @ 菜单保持纯寻址（只列已有成员）；邀请收在成员 tab 的弹窗和主 agent 的 `room_invite` 工具里。

### Why not 把成员产出写成 room 会话里模型可见的事件？

那样主 agent 能"免费"感知成员活动，但代价是被迫全程旁听：上下文灌水，而且主 agent 可能对成员产出自作主张接话。成员发言保持模型不可见；主 agent 天然看得到人的非派发消息（裸消息作为正常回合放行），这恰好是合适的感知下限。

### Why not 在 session-store 层面做新的会话类型？

会话 header schema 是官方且固定的；一条 `room/created` 自定义事件就能提供同等身份与 replay 语义，无需改动宿主。

## Acceptance criteria

- `+ 新 room` 创建流程产出一个以 room 形态打开的会话（重开时从 `room/created` 事件恢复身份）；视图导航有成员 tab；有任务时 dock 出现任务板。
- 不带 @ 的消息产生正常的主 agent 回合；`@ada <任务>` 派发（首轮 fresh、之后 resume——子会话 transcript 验证）；未知成员结构化拒绝；两个成员并行、同一成员串行。
- 每次派发的 prompt 含名册、该成员的待收通知、本次文本——**且无滚动流水账、无任务板摘要**（绝不重发成员已见过的内容，成员也不感知 room 全景）。
- 邀请弹窗：provider 列表反映 `localAgent.roster()` 登录态；cwd 缺省继承 room 会话且按成员生效（门面 R2）；角色指令可在子会话首轮验证拼在最前。主 agent 的 `room_invite` 工具产出完全相同的成员记录；重名或含 `@`/空白的名字以工具错误拒绝。
- 成员回复末尾独占行的 `@名字 <内容>` 产出待转派行；人确认即把通知派发给收件人；忽略即丢弃。未确认的转派不触达任何人。
- 任务板：派发开任务、完成发言闭任务；人可在 dock 条上增删改派；重开后任务板经 journal replay 恢复。
- 成员发言渲染为身份行 + 无框 markdown + 操作行（复制、会话跳转、耗时、hover 时间戳）；无分支、无 TPS；运行中行可跳转子会话、行尾停止按钮可中断；边界事件渲染为 dim 单行。仅靠 alias token 即暗色正确。
- 重开 room 会话后，身份、名册、任务板、发言历史从事件 replay 恢复（room 事件类型已登记进持久化目录）。
- 包可独立安装、运行、卸载；未挂载 local-agent provider 时 room 仍可用（主 agent 是唯一成员）。

## Risks

- **轮次延迟、无流式**：成员每轮是一个完整 CLI 进程生命周期；实时镜像（家族 M3）与运行中行承担进度呈现。
- **通知格式漂移**：成员必须按"末尾独占行 @名字"的约定输出才会被检出为转派；角色指令与名册注入都写明了，但模型偶尔会"提到而非通知"（正确忽略）或"在行文中通知"（漏检）。一阶段人工确认闸门兜住误报；漏报由人直接 @ 兜底。
- **任务板一致性**：任务板是 room（派发开闭）与人（编辑）共同写入的派生状态；成员一阶段不能直接汇报进度到板上（只能发通知）。可接受：任务板是人的管理视图，不是成员的草稿纸。
- **未验证的接缝**：composer 接管组件内裸消息放行官方提交路径；`conversation.input.dock` 与官方 todo 条的多条目共存。动工前先写 spike 验证。
- **复刻内部 chrome**：`.refChip`、`MessageIconActions`、`DisclosureRow` 不是导出的插件 API，我们复刻其样式。上游视觉漂移是维护税——属装饰层、可接受。
- **跨包依赖**：CLI 成员依赖 local-agent 门面；R1/R2/R3 是家族侧工作，走家族自己的提案管道跟踪。
