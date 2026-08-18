# @khorsheed/dsh-room

[English](README.md) | 中文

Room 是一个被标记为多 agent 群聊的普通 dsh 会话：标准聊天 UI 中容纳若干通过 @ 提及寻址的对等成员，人类是中枢。room 的全部状态——身份、名册、黑板、派发记录、运行态——都是 room 会话上的自定义会话事件（`room/*`）journal，由纯函数 replay 折叠；host 侧是 `room` Typert Remote 服务（`createRoom` / `isRoom` / `getState` / `invite` / `updateMember` / `removeMember` / `postMessage` / `cancel` / `listProviders`），client 侧经 `ctx.remote.$mount` 挂载生成的 Remote 面，只注册官方 slot/Definition 条目——装进任何 profile 都不需要改动核心包。

派发：room 输入框开头的 `@name` token 寻址成员（多个 @ 扇出）；裸消息只记录到黑板、不触发任何成员，并有轻提示说明。@ 补全只列已有成员——纯寻址，不做邀请。每次成员派发携带统一 prompt：成员的角色指令（首轮注入；之后的编辑作为"指令更新"随下一次派发携带）+ 该成员上次被派发以来的黑板增量 + 本次消息文本。同成员派发串行（家族 resume 锁本来就只允许每子会话一个在飞 resume）；不同成员并行。

成员：会话自己的主 agent 在创建 room 时以平等成员（`main`）入座——不被 @ 就什么也感知不到、什么也不说（自定义事件不进 `deriveMessages()`，成员活动对它默认模型不可见）。CLI 成员是 local-agent 家族的委派：首次派发开一个全新子会话（`parentSession` = room 会话），后续派发续跑同一条 CLI 会话，委派句柄记进 journal（`room/member-updated` 带 `childSessionId`），重开可重挂。成员 tab（`成员` 视图）管名册——行级状态 + 耗时、轨迹跳转、中断、指令编辑、移除——以及邀请弹窗（provider 列表反映 local-agent 名册的登录态，未登录置灰）。主 agent 也能邀请：模型工具 `room_invite` 走同一 invite 路径，记 `invitedBy: 'agent'`。

聊天流：成员回复渲染为身份行（成员色圆点 + 名字胶囊 + provider）+ 无框 markdown + 复刻官方 IconActions 的操作行（复制、子会话跳转、真实耗时、hover 淡入时间戳——刻意无分支、无 TPS）；运行中的成员是 ToolRow 同构 24px 行（StateDot +「ada 正在工作… · 12s」+ 扫光，带 `prefers-reduced-motion` 兜底），整行点击跳子会话，行尾停止按钮接 `cancel`；加入/离开与人类自己的消息渲染为 compaction 式 dim 单行。

## 安装

```sh
dsh plugin add @khorsheed/dsh-room
```

包是自挂载的：`dsh.bundle.patch` 插入 `room` loader 行，浏览器半经 `dsh.client` 块被发现。卸载插件即移除它添加的所有界面。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.0-rc.7`）：⚠️ 降级——**CLI 成员不可用**：CLI 成员依赖 local-agent 家族的公开委派门面（`start`/`resume`/`cancel`，即 `proposals/active/2026-08-18-local-agent-delegation-api.md` 的 M1，已合入本仓 main），已发布的 `@khorsheed/dsh-local-agent` 尚未携带（npm 上尚无该包）。invite 返回 `local-agent-unavailable`；主 agent 成员与其余所有面正常。
- 源码线（deepseek-harness master）：✅ 完整——CLI 成员需挂载 M1 及以后的 local-agent 家族。

**持久化**：room 在 apply 时把 8 种 `room/*` 事件类型登记进 harness 的 `KNOWN_SESSION_EVENT_TYPES` 目录（一次带断言的 `Set.add`；该目录头部注释把仓外插件的注册面推迟到"出现消费方"——room 就是这个消费方，此处是该注册面的临时形态，上游出正式 surface 后迁移）。持久化的 room 会话在任何装了 room 的 build 上可重载；在未装 room 的 build 上依然被拒绝——这是安全语义，原样保留。

## 已知限制与缓建项

- **无实时 room 状态订阅**：client store 在进入时和自身 mutation 后拉 `getState`，且仅在当前 room 有运行中成员时每 2s 轮询。其他客户端（或工具）的写入至多一个轮询周期内可见。
- **黑板全量增量、无窗口裁剪**：每次派发携带该成员的全部未读增量；成员多的长 room 会放大 CLI 侧 token 成本。窗口/摘要策略缓建。
- **成员间 @ 未接线**：成员回复里的 `@other` 还不会浮现人类确认的待派发卡片（二期接缝）。
- **跨重启 CLI 续跑**需要家族门面的 M4（委派映射持久化）：host 重启后 room 会话本身可重载，但 `resolveDelegation` 在内存映射上 miss，成员的下一次派发会失败，直到 M4 落地。
- **成员视觉身份是复刻的 chrome**：`.refChip`、IconActions 行、ToolRow 扫光都不是导出的插件 API，room 复刻其样式。上游视觉漂移是维护税——属外观层，可接受。
