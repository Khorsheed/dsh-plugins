# 变更记录

## 未发布

- 后台 Agent 与当前计划改用可折叠胶囊；运行中显示绿点，展开可查看执行任务、用量、会话并中止具体轮次。
- 记录 Room 单次执行历史，归集宿主登记的下级会话；原生子会话用量明确标为会话累计。
- 计划详情接入可选宿主侧栏，缺少侧栏时在面板内展开；运行限制默认折叠。

## 0.1.1（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2——3080 生产实证线随宿主基线切到 rc.2；rc.1→rc.2 无触及本包的宿主变更，全量构建+测试双绿）。

- README 落地房间主视图实拍截图
- 伴生工具行 `@khorsheed/dsh-room-tool` 0.1.1 修复 rc.1 挂载顺序下工具行静默惰死（核心服务改声明式 inject，见其 CHANGELOG）

## 0.1.0（2026-09-26）

首个公开发布。按单实例多模式提案（2026-08-26）拆出模型工具行（M4'②，worktrees 之后的第二对 core/companion）。

- **BREAKING**：模型可见的 `room_invite` / `room_task` / `room_message` 工具不再由 core 在 profile 根注册——拆为伴生包 `@khorsheed/dsh-room-tool`（不 `ctx.provide`、不声明 `dsh.bundle` 的不自挂载行），由各 agent preset 的 `agent.cordis.yml` 按名引用、按会话授予。迁移：安装伴生包并在目标 preset 加 `- id: room-tool / name: '@khorsheed/dsh-room-tool'`（web-dev 的 dev preset 已带此行）；工具定义工厂（`roomInviteTool` / `roomTaskTool` / `roomMessageTool`）经 core 的 `./tool` 导出供伴生包复用，业务实现零复制，origin tag 归伴生包
- room 服务、成员 UI（成员 tab / 邀请对话框 / 任务板 / 通知闸门）与全部 Remote 行为不变
- **会话 chrome 按 preset 自隐（M3'②）**：「邀请 agent」chip 与「成员」tab 只在当前会话的 preset 组合含 `@khorsheed/dsh-room-tool` 行时呈现（官方 `pluginInventory` 判据，worktrees 徽标同路径、包内内联）；读不到 fail-open 显示；已是 room 的会话始终保留界面（E1）。成员 tab 隐藏走注册层（tab 按钮来自槽位注册表，注销而非空体）
