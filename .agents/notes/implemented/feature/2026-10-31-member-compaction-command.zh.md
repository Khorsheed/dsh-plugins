# Agent Note：`/compact` 送到成员，房间显示一行压缩记录

Status: implemented

## 问题

压缩轮（2026-10-31-member-compaction-round）缺入口。用户选了斜杠命令，不另加按钮（交互稿 `proposals/prototypes/member-compaction.html`，2026-10-31）：
- 成员会话里 `/compact` 压缩该成员；
- 房间里 `/compact` 压缩协调者，`@成员 /compact` 压缩该成员。

压缩期间的输入排队到结束；CLI 给了摘要就可以展开。

## 决定

- **local-agent 收件箱**：正文恰为 `/compact`（`isCompactCommand`）时，以 `operation: 'compact'` resume。成员 FIFO 本来就会让之后的输入排在它后面。
- **room 派发**（`runCliMember`）：人发来的正文恰为 `/compact` 时，发压缩轮，不发带简报的提示。
  - 不写 `room/speech`。Kimi 对 `/compact` 会回一段摘要文字，那属于压缩行，不算回复。
  - 追加一条 `room/member-compacted`，内容取自子会话最后一条 `local-agent/compaction`：结果、前后 token 数、窗口、用量、摘要、错误、耗时。该类型已登记进 `ROOM_EVENT_TYPES`。
  - 从没跑过的成员：投递直接完成，显示「还没有可压缩的上下文」，不启动任何东西。
- **room 客户端**：`room-compaction` 节点（`RoomCompactionView`）画一行暗色记录，带「看摘要 / 收起摘要」，另有失败态。
- **协调者路径**：dsh 当协调者时，不带 @、不带附件的 `/compact` 经 `ctx.remote.commands.execute` 跑宿主自己的 `/compact`。那是宿主的压缩，房间不另记。

## 考虑过的方案

- **房间输入框加「压缩」按钮**：用户否了，属于重复设计。按钮只归压缩提醒插件，且超过阈值才出现（后续阶段做）。
- **让 Kimi 的摘要作为发言落地**：不采用。看起来像成员回复，协调者会把它当回复处理。
- **正文任何位置含 `/compact` 都算**：不采用。只有整条恰为命令才不会误判，正文里提到 /compact 仍按普通消息处理。

## 影响

- 成员的 `/compact` 和普通轮次一样占住队列，期间打的消息在压缩结束后送达，不会被 Kimi 丢掉。
- 房间日志多了 `room/member-compacted`。没装这版 room 的宿主会拒开这样的日志，与其他房间类型一样。
- 尚待后续：圆环与阈值提醒（压缩提醒插件经 `local-agent.member.tools`）、CLI 自动压缩记为 `source: 'auto'`、Context Lens 读取 `local-agent/compaction`。
