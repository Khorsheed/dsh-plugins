# 变更记录

## 未发布

- **run-state 边携带子会话关联**:`room/run-state` 在身份存在后的所有边恒带 `childSessionId`（成员首跑的 running 边早于句柄产生，终态边与后续轮次都有）；终态边（done/cancelled/failed）新增 `childTurn`（该运行写入子会话的轮次号，只读在内存的存活会话）。`room/dispatch`、`room/run-state`、`room/coordinator`、`room/member-added` 是 Context Lens 的外部读取接口（类型注释已标注）。

## 0.2.2（2026-10-22）

- **房间输入条草稿接入官方 input machine**：草稿不再存组件本地 state，房间接管条与官方回退输入条共享同一份草稿——「引用到当前会话」等外部写入立即在房间里可见（此前写入成功却只渲染在隐藏的回退条里，看似失效）；草稿随机器持久化，跨导航/重挂存活；首次拉取窗口期在回退条打的字在接管当选后保留。发送路径不变：仍走房间自己的 `remote.room.postMessage` 派发，`inputActions.submit` 永不调用，机器忙碌准入不会串行化并行成员派发。引用 chip 在纯 textarea 投影为剪贴板文本、编辑即摊平（接受的房间侧降级）。
- 自隐 tab（成员 tab 等 `conversation.view` 条目）的注册/注销切换延后到下一帧（requestAnimationFrame），避开宿主 ui-conversation `refreshViews` 对已释放会话滞留绑定的 uncaught throw 窗口期——上游修复提案见 docs/upstream-proposals/2026-10-20-refreshviews-stale-binding-robustness.md。
- 适配宿主 0.2.1 线：peer 区间加宽覆盖 0.2.1；`./tool` 子路径行 locale 重定向到包根，宿主设置清单页显示插件卡片标题而非裸模块名；退役 load 期 invariant 伴生探针并声明 `engines.dsh`。

## 0.2.1（2026-09-30）

无功能变更。加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.2.0（2026-09-28）

- **BREAKING（包结构）**：伴生包 `@khorsheed/dsh-room-tool` 回并进本包——模型工具行改由本包的 `./tool` 子路径导出承载（preset 引 `name: '@khorsheed/dsh-room/tool'`，行 id 仍为 `room-tool`，preset 组合状态不受影响；worktrees 0.3.0 同款回并，canvas `./agent` 先例）。迁移：preset 的 `agent.cordis.yml` 里把 `name: '@khorsheed/dsh-room-tool'` 改为 `name: '@khorsheed/dsh-room/tool'`，并卸载旧伴生包（旧 npm 名将在发布波 deprecate）。`./tool` 的导出内容从工具定义工厂变为可直接挂载的组合行（`name` / `inject = ['room']` / `apply`）；工厂退到内部模块 `./tool-definition.ts`（不进 exports 面）。
- 会话 chrome 的 preset 组合判据常量同步指向 `@khorsheed/dsh-room/tool`。
- 工具 origin 归因 owner 归一到本包名 `@khorsheed/dsh-room`。
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
