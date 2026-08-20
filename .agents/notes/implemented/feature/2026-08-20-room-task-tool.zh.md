# Agent Note: room — the room_task model tool (the board's third write path)

Status: implemented

[English](2026-08-20-room-task-tool.md) | 中文

## Problem

room 任务板原本只有两条写入路径：人的胶囊 UI（`addTask`/`closeTask` Remote）和派发自动开任务（@-消息为每个目标记一条 `in_progress` 任务）。房间的**主 agent** 一条都没有：它的官方 todo 工具写的是房间看不见的私有草稿，所以当它想公开承诺一件工作——任务板存在的本意就是这种协作姿态——没有通道。这个缺口的不对称让模型困惑：成员可以由 agent 邀请（`room_invite`），agent 自己却没法把任务写上共享板。

## Decision

`room_task`（packages/room/src/tool.ts）是任务板的第三条写入路径，与 `room_invite` 同族：一个 `defineTool` 定义，经延迟挂载的 `ctx.inject(['tools'])` 注册，执行时门控（调用会话必须带 `room/created` 标记），拒绝时回答可读、可自纠的文本而不是抛错。

**每次写入都走与 UI 完全相同的 host 函数。** `add` 调 `RoomService.addTask`，`close` 调 `RoomService.closeTask`——agent 开的任务与人添加的逐字节同构（成员泳道上的 `pending` 任务）。工具描述里明确写出公私分界：这块板与所有成员和人共享；agent 自己的 todo 工具仍是私有工作计划。

**`update` 需要一个新的 journal 事件。** 该 action 编辑进行中任务的标题和/或 `blockedBy`，没有现存事件能承载。`room/task-edited`（`{ id, title?, blockedBy?: string | null }`——显式 null 清除等待）加入词汇表、replay 折叠和持久化目录；背后的 `RoomService.updateTask` 只是 host 方法、不是 Remote，因为胶囊 UI 除了目标什么都不编辑。已关闭任务不接受编辑（`task-closed`）；没有字段可改是 `nothing-to-update`。

**错误可自纠。** `member-not-found` 的回答带上实时名册；`task-not-found` 带上未结任务清单（id——标题——成员——状态），这也是模型获知 id 的唯一途径（`add` 的成功文本返回新 id 并嘱咐模型记住）。blockedBy 参数是 string/null 的 `oneOf`，让 `update` 能清除等待；`add` 传 null blockedBy 会被拒绝并提示直接省略。

## Alternatives considered

- **让主 agent 用私有 todo 工具写板、中间加同步桥**——否决：两套任务模型加同步层会双向漂移（状态词汇不同、删除语义含糊），而任务板的价值恰恰在于只有一份人人可读的清单；直接经现有 host 函数写入没有漂移面。
- **`update` 做成状态流转（pending ↔ in_progress）而不是字段编辑**——否决：状态流转已有属主（派发引擎自动开、发言落定自动关），模型驱动的状态写入会与引擎竞争；标题/blockedBy 编辑才是没有写入方的缺口。
- **为对称把 `updateTask` 也注册成 Remote**——否决：没有浏览器调用方（胶囊 UI 只编辑目标），没有消费者的 Remote 是白占的表面积；该方法留在 host 侧，直到 UI 出现需求。

## Consequences

- 工具的输出契约是纯文本（`{ text }`），与 `room_invite` 相同：模型读结果，没有任何渲染消费它。
- 旧 journal 回放不变（新事件类型是纯增量）；不带 room 的构建仍然整体拒绝 room 日志，所以新类型除了目录注册不需要任何处理。
- 模型现在能让板面与现实保持一致（关掉完成的、改掉变了范围的）——板面的可信度不再依赖人替主 agent 的泳道做清洁。
- 7 个新测试钉住门控、add/close/update 语义、`room/task-edited` 折叠（含 null 清除）、持久化往返，以及每一条可自纠错误文本。

## Testing

`packages/room/tests/tool.host.spec.ts` 新增 `room_task` describe（真实组合：服务、打桩的 tools 注册表、活房间）：注册形状与共享板措辞、非 agent/非房间门控、add 与 UI 路径逐字节同构且返回 id、名册外 member/blockedBy 的拒绝带名册、close 对未知/已关 id 的拒绝带未结清单、update 的改名/改指/null 清除/空编辑/已关任务各路径。`journal.host.spec.ts` 钉住 `room/task-edited` 折叠；`persistence.host.spec.ts` 往返新事件类型。
