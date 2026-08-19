# @khorsheed/dsh-room

[English](README.md) | 中文

Room 是一个被标记为多 agent 群聊的普通 dsh 会话：标准聊天 UI 中容纳若干通过 @ 提及寻址的对等成员，人类是中枢。room 的全部状态——身份、名册、派发记录、通知转派、任务板、运行态——都是 room 会话上的自定义会话事件（`room/*`）journal，由纯函数 replay 折叠；host 侧是 `room` Typert Remote 服务（`createRoom` / `isRoom` / `getState` / `invite` / `updateMember` / `removeMember` / `postMessage` / `confirmRelay` / `dismissRelay` / `addTask` / `closeTask` / `cancel` / `listProviders`），client 侧经 `ctx.remote.$mount` 挂载生成的 Remote 面，只注册官方 slot/Definition 条目——装进任何 profile 都不需要改动核心包。

派发：room 输入框开头的 `@name` token 寻址成员（多个 @ 扇出）；裸消息（开头无 @）放行给官方提交路径——即 room 自己的主 agent 的普通回合（host 侧 postMessage 对裸消息返回结构化 `no-targets` 错误，纯防御）。@ 补全只列已有成员——纯寻址，不做邀请。**没有黑板**：每次成员派发携带的 prompt 恰好四样——成员的角色指令（首轮注入；之后的编辑作为"指令更新"随下一次派发携带）、名册（谁存在，附通知协议）、寻址到该成员的已确认未投递通知、本次消息文本。成员不感知 room 的流水账；它们自己的 CLI 会话（resume 链）持有工作记忆。同成员派发串行（家族 resume 锁本来就只允许每子会话一个在飞 resume）；不同成员并行。

成员：会话自己的主 agent 在创建 room 时以平等成员（`main`）入座——裸消息经官方提交路径天然到达它，成员活动对它默认模型不可见（自定义事件不进 `deriveMessages()`）。CLI 成员是 local-agent 家族的委派：首次派发开一个全新子会话（`parentSession` = room 会话），后续派发续跑同一条 CLI 会话，委派句柄记进 journal（`room/member-updated` 带 `childSessionId`），重开可重挂。成员 tab（`成员` 视图）管名册——行级的名字/provider/角色指令/状态 + 耗时、轨迹跳转、中断、指令编辑、移除——以及邀请弹窗（provider 列表反映 local-agent 名册的登录态，未登录置灰；**cwd 字段**留空 = 继承 room 会话 cwd——记进名册，暂不下发门面，等家族的按调用 cwd 覆盖落地）。主 agent 也能邀请：模型工具 `room_invite` 走同一 invite 路径，记 `invitedBy: 'agent'`。

成员间通知：家族桥接调 room 的闸门入口 `receiveMemberMessage({ from, to, content, parentSessionId, provenance })`（逐字冻结的契约）；桥接缺席时，回复**末尾独占行**的 `@名字 <内容>`（名册注入教的格式）被检出为同一条待转派。一阶段闸门恒为人工确认：转派以 pending 行出现在聊天流（`⇢ ada → bill: …` 加 [确认派发] [忽略]），发送方收到的回执诚实地是 `pending-confirm`（不是 `sent`）；确认后通知作为收件人续轮投递（`{from} 给你的通知: …`），收件人自己的会话收到 prompt 后转派折叠为 `sent`——投递失败的转派会随收件人的下一次派发进入其通知区重投。

任务板：人的管理视图，与其他一切一样由 journal 驱动（`room/task-*`）。@ 派发自动在目标成员名下开 in_progress 任务（title = 派发文本截断）；成员 speech settle 闭任务（完成 → done，中断 → cancelled；失败的运行留给人）。`conversation.input.dock` 上的任务板条——与官方 todo 条同一坑位、彼此叠加共存——按成员分组，支持添加/关闭。任务板不进任何成员的 prompt。

聊天流：成员回复渲染为身份行（成员色圆点 + 名字胶囊 + provider）+ 无框 markdown + 复刻官方 IconActions 的操作行（复制、子会话跳转、真实耗时、hover 淡入时间戳——刻意无分支、无 TPS）；运行中的成员是 ToolRow 同构 24px 行（StateDot +「ada 正在工作… · 12s」+ 扫光，带 `prefers-reduced-motion` 兜底），整行点击跳子会话，行尾停止按钮接 `cancel`；加入/离开、人自己的派发与已完结的转派渲染为 compaction 式 dim 单行。

## 安装

```sh
dsh plugin add @khorsheed/dsh-room
```

包是自挂载的：`dsh.bundle.patch` 插入 `room` loader 行，浏览器半经 `dsh.client` 块被发现。卸载插件即移除它添加的所有界面。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.0-rc.7`）：⚠️ 降级——**CLI 成员不可用**：CLI 成员依赖 local-agent 家族的公开委派门面（`start`/`resume`/`cancel`，即 `proposals/active/2026-08-18-local-agent-delegation-api.md` 的 M1，已合入本仓 main），已发布的 `@khorsheed/dsh-local-agent` 尚未携带（npm 上尚无该包）。invite 返回 `local-agent-unavailable`；主 agent 成员与其余所有面正常。
- 源码线（deepseek-harness master）：✅ 完整——CLI 成员需挂载 M1 及以后的 local-agent 家族。结构化的成员互通知另需家族的 member-channel 桥接（`proposals/active/2026-08-19-local-agent-member-channel.md`）；桥接缺席时由降级通道（回复末尾独占行 `@名字 <内容>`）承载通知。

**持久化**：room 在 apply 时把全部 `room/*` 事件类型登记进 harness 的 `KNOWN_SESSION_EVENT_TYPES` 目录（一次带断言的 `Set.add`；该目录头部注释把仓外插件的注册面推迟到"出现消费方"——room 就是这个消费方，此处是该注册面的临时形态，上游出正式 surface 后迁移）。持久化的 room 会话在任何装了 room 的 build 上可重载；在未装 room 的 build 上依然被拒绝——这是安全语义，原样保留。

## 已知限制与缓建项

- **无实时 room 状态订阅**：client store 在进入时和自身 mutation 后拉 `getState`，且仅在当前 room 有运行中成员时每 2s 轮询。其他客户端（或工具）的写入至多一个轮询周期内可见。
- **通知闸门恒人工**：一阶段永远先出人确认卡；自动闸门 + 级联预算（二期）缓建。降级通道的格式可能漂移（"提到而非通知"的行被正确忽略；行文中的通知漏检——由人直接 @ 兜底）。
- **成员级 cwd 只记名册**：邀请落名册，但委派门面的按调用 cwd 覆盖（家族需求 R2）未落地，成员仍在 room 会话的 cwd 里运行。
- **跨重启 CLI 续跑**需要家族门面的 M4（委派映射持久化）：host 重启后 room 会话本身可重载，但 `resolveDelegation` 在内存映射上 miss，成员的下一次派发会失败，直到 M4 落地。
- **成员视觉身份是复刻的 chrome**：`.refChip`、IconActions 行、ToolRow 扫光都不是导出的插件 API，room 复刻其样式。上游视觉漂移是维护税——属外观层，可接受。
