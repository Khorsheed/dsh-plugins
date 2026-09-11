# 变更记录

## Unreleased

按单实例多模式提案（2026-08-26）拆出模型工具行（M4'②，worktrees 之后的第二对 core/companion）。

- **BREAKING**：模型可见的 `room_invite` / `room_task` / `room_message` 工具不再由 core 在 profile 根注册——拆为伴生包 `@khorsheed/dsh-room-tool`（不 `ctx.provide`、不声明 `dsh.bundle` 的不自挂载行），由各 agent preset 的 `agent.cordis.yml` 按名引用、按会话授予。迁移：安装伴生包并在目标 preset 加 `- id: room-tool / name: '@khorsheed/dsh-room-tool'`（web-dev 的 dev preset 已带此行）；工具定义工厂（`roomInviteTool` / `roomTaskTool` / `roomMessageTool`）经 core 的 `./tool` 导出供伴生包复用，业务实现零复制，origin tag 归伴生包
- room 服务、成员 UI（成员 tab / 邀请对话框 / 任务板 / 通知闸门）与全部 Remote 行为不变
- **会话 chrome 按 preset 自隐（M3'②）**：「邀请 agent」chip 与「成员」tab 只在当前会话的 preset 组合含 `@khorsheed/dsh-room-tool` 行时呈现（官方 `pluginInventory` 判据，worktrees 徽标同路径、包内内联）；读不到 fail-open 显示；已是 room 的会话始终保留界面（E1）。成员 tab 隐藏走注册层（tab 按钮来自槽位注册表，注销而非空体）
