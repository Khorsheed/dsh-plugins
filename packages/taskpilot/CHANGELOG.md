# 变更记录

## 0.3.1（2026-09-26）

适配宿主 rc.1 线并实证 0.1.5/0.1.7 双线可用（0.1.5-rc.1 全量 boot 实证，2026-09-25）。

- 作业花名册双通道：rc.1 走 `ctx.jobs`（jobs-channel 代理 + watchRows），0.1.5 落 `jobsBySession` 鸭子读；子代理目录读 `projectionsBySession`（0.1.5 落 `subagentsByParent`）；宿主侧 kill 调用者改 SessionId
- 详情 tab 的耗时在运行中每秒走秒，算不出时显示 —
- 会话面迁移：宿主移除 `ISessions.open/current` 后的读面切换
- 插件清单展示元数据（`locale/*.json`）：rc.1 宿主插件页的卡面标题/描述中文化

## 0.3.0（2026-09-11）

迁移至宿主 0.1.5 的右栏体系。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` 的用户请停留在 `0.2.0`
- 详情抽屉（`shell.overlay` 浮层 + 推开布局）整体退役，改为官方右栏的 page-type tab：类型注册进 `ctx.sidebarRightTabs`（kind `taskpilot`，extension 档默认优先级），body 与 chip 标题进 keyed `sidebar.right.pane.tab(.title)` 槽位；胶囊的详情入口改调 `ctx.sidebarRight.openTab('taskpilot', { params: { jobId } })`，同一 tab 内重新导航切换任务
- 删除抽屉自有状态（drawer store）、推开布局（drawer-inset）与 document 标记逻辑：宽度/全屏/停靠几何全部交给右栏
- `dsh-client-store` 依赖随抽屉 store 一并移除；新增 `@deepseek-ai/dsh-client-ui-sidebar-right` peer 依赖

## 0.2.0（2026-09-10）

适配宿主 0.1.2 线。

- **BREAKING**：minHost 前移至 `0.1.2-rc.1`；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 线（末版 `0.1.0`）
- 详情抽屉执行轨迹的历史 loader 改走 `remote.session` 的 follow/page 通道（适配 0.1.2 的 remote 会话面）
- store 引擎导入面迁移：`defineStore` 与 `EngineStoreHandle` 同包取自 `dsh-client-store`，client bundle 不再引用宿主已删除的 `dsh-client-runtime`
- 子 agent 行的 running 判定改为双源:官方 summary 标志之外,增加对 local-agent 家族只读委派通道(`localAgentGateway.activeDelegations`)的轮询(有行展示时每 1.5s 一次)。一次性外部 CLI 委派(kimi/codex/claude/dsh)在飞期间现在会显示中止按钮,点击走既有 `/taskpilot-interrupt` → `/local-agent stop` 链路;未安装 local-agent 时软失败为空集,行为与之前完全一致,两家插件仍互不依赖。
- `/taskpilot-interrupt` 注册补上 `input` hint(`<child-session-id> [parent-session-id]`),手打带参数的命令现在会被 composer 拦截。

## 0.1.0（2026-08-22）

首个公开发布。

- 聊天框上方「后台任务」「子 agent」两枚胶囊，随时查看运行状态、时长与 token 消耗
- 运行中的后台任务一键停止；子 agent 一键中断，点击跳转该子 agent 会话
- 详情抽屉：命令/类型/状态/起止/耗时，附从会话日志回放的执行轨迹
- 宽屏下抽屉把聊天区整体左推让出宽度，内容不被遮挡；窄屏退回覆盖式浮层
- 会话级显隐：切换会话即切换数据，胶囊只在自己的数据非空时出现
