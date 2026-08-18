# @khorsheed/dsh-room

[English](README.md) | 中文

Room：一个被标记为多 agent 群聊的普通 dsh 会话——标准聊天 UI 中容纳若干通过 @ 提及寻址的对等成员。完整设计见 `.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`。

**状态：WIP（Step 0 spike + Step 1 脚手架）。** 目前已有：

- host 端 `room` Typert Remote 服务：`createRoom` 创建一个普通会话并追加 log-only 的 `room/created` 身份标记自定义事件（持久化与重载回放免费获得）；`isRoom` 从事件日志恢复 room 身份。
- client 端 slot 注册：sidebar 底部的「新建 Room」按钮、一个永不接管的 `conversation.composer` chain 条目（仅验证注册形态；@ 派发接管在 Step 5）、以及占位的 `conversation.view` 成员 tab。

## Compatibility

WIP——尚未针对任何 host 发布线做审计。

| Host 线 | 结论 |
| --- | --- |
| npm 发布线（`0.1.0-rc.x`） | WIP |
| deepseek-harness master | WIP |
