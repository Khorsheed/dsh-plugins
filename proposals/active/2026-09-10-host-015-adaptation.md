# 宿主 0.1.5 适配与 UI 归位（host-015-adaptation）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-10
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`。最近邻：room-composer-parity（composer 对齐已在册，本提案不重复立项）、worktree-governance（badge/抽屉能力本体在册，本提案只覆盖其入口迁移）、file-view-html-rendering、local-agent-dsh-sdk-resume（S8 仍堵，维持原判）、capability-catalog（S13 仍堵）。无「0.1.5 整体适配」提案，新建。
- **官方依赖**：纯插件。所有切换走官方 0.1.5-rc.1 已发布的扩展面，不含新 seam 请求。

## 目标

把全仓插件对齐到宿主 0.1.5-rc.1：拆掉已被官方能力覆盖的绕行（S1、S5），UI 按「右栏 = 会话级阅览面 / 左栏 rail + 整页 main = 全局应用页 / 消息区浮层不动」分层归位，完成 breaking 适配。审计基线：`0.1.2-rc.1 (a66e470204) → 0.1.5-rc.1 (2377c272a8)`，rc.1 相对 alpha.2 无回退（模型目录切 V41 Flash + sidebar 视觉打磨）。

## 现状（0.1.5-rc.1 源码实测结论）

### 缝退役核对（upstream-seam-registry）

- **S1 ✅ 已落地**：产物行 / 正文 mention / 工具结果行三处打开入口统一收敛到 `ctx.sidebarRight.openResource()`；`ctx.sidebarRightTabs.register()` 认领注册表（glob patterns + `priority: 'extension'` 默认压过内置）允许第三方接管。DOM 拦截与 `priority: -1` 抢 chain 可拆。
- **S5 ✅ 已落地**：`@deepseek-ai/dsh-typert-generator@0.1.5-alpha.2` 已上 npm（`WorkspaceAnalyzer` + `./tsdown` 子路径 `typertPlugin()`）。社区仓布局下能否独立跑通需实测（其模型假设 host/client 双面 tsconfig 聚合）。
- **S11(a) 🟡 部分落地**：跨进程写所有权租约（`session.lock.json`）+ append 连续性断言封死双写根因；恢复仍写伪中断块。S11(b) 未落地：会话 list 仍会被单个 zstd 坏帧拖垮。
- **S2/S3/S4/S8/S10/S12/S13/S14 ❌ 未落地**：bash 写入采集、dispatch diff/turn 归属、SDK turn interrupt、skill source 默认值、assistant-role 恢复（消息编辑在 alpha.2 被 revert、rc.1 未回归）、ToolSchema 来源、AgentStatus 二元——全部维持现状绕行，不排期。

### 新能力面（插件可消费）

- **右栏体系**：`ctx.sidebarRightTabs`（tab 类型注册表，page-type 可从 guide 进入不认领地址——官方 ui-sidebar-files 即此形态）+ keyed slot `sidebar.right.pane.tab(.title)` + `sidebar.right.tab.guide/menu.item`。
- **文档预览**：`ctx.documentPreviews.register()` 按文件后缀注册渲染器（`matchingDocumentPreviews` 纯后缀匹配、与协议无关，extension 档优先）；内置 markdown/code/image/pdf/html 六渲染器。**但内置渲染器组件不可外部复用**：`sidebar.right.tab.document` seat 遵循 slot 申领规则（只有声明方 documentpreview 能渲染），且官方 document tab 只认领 `dsh-resource://file/**`、内容只走 workspace-scoped 的 `remote.workspaceFiles`——工作区外路径必须自绘。
- **资源层**：`ctx.resources`（协议可声明合并）+ `remote.workspaceFiles`（read/stat/list/changes）+ `ctx.fs.readByteRange`（本地 + e2b）。
- **全局 panel**：root 作用域 `sidebar.panellist`（左栏 rail 图标行，折叠态 56px 仅图标 + tooltip）+ 同 id keyed `main` slot——点选即**整页替换主内容区**（`conversation` 为保留 key，`ctx.layout.selectPanel(id|null)`）。**panel 选中态是 root 级，不随会话切换**；官方默认组合未注册任何 panel。**适用面窄**：只适合真正跨会话的全局页；会话级协作 UI 放这里会在选中期间整个丢掉会话视图，不用（见方案第三批）。
- **会话 header corner slot**：`conversation.session.header.corner`（single / session），rc.1 槽位净变化仅此一处新增（另删 `conversation.details.tool`，我方无人使用）。
- **右栏几何**：首开 45% 视口、拖宽像素记忆、上限 70%；`ctx.layout.openRightbar(track, fullscreen)` 可 fullscreen。
- **open-in-app**：`@deepseek-ai/dsh-host-open-in-app`（webServer 路由，connection 鉴权）+ client header 入口，web 默认 bundle 已带——三包 external-open 的恢复通道。
- **subagent 目录**：`subagent/catalog` 事件 + `establishCatalogChild()` helper（父会话可发现子会话）。
- **Agent Teams 实验包**：`dsh-experimental-agent-team{,-profile,-web-profile}` + `tool-agent-team` + `client-ui-agent-team`（0.1.5-alpha.2 首发，无稳定性承诺）。

### Breaking（不改即坏）

| 变化 | 影响方 |
|---|---|
| format v2/v3：`assistant/chunk` → `assistant/attempt`；follow 流混 `assistant-stream` frame；wire `conversationOp: replace` | message-tools、message-timeline 投影层 |
| `tool/code-dispatch*` → `tool/ptc-dispatch*` | file-preview `src/fold.ts`、capability-catalog 事件词表 |
| slash command description 变 thunk `() => string` | datasets、mission、lab、eval 命令贡献 |
| `persona` 拆 `personaPrefix`/`personaSuffix` | profiles/*.yml |
| `ctx.agent` 删除（迁 `ctx.agents`）、Inbox 服务移除 | 已 grep 全仓：无人踩到，零工作 |
| `conversation.details.tool` 删除 | 已 grep 全仓：无人踩到，零工作 |
| `session-query` stateOf 只支持 all/none | 按 projection 取水处自查 |
| str_replace_editor 删除 | 无人依赖（确认过） |

## 方案

### 第一批：breaking 适配（先行，不动 UI）

1. message-tools / message-timeline 投影适配 `assistant/attempt` + `conversationOp: replace`。
2. file-preview `fold.ts` 事件改名 `tool/ptc-dispatch*`；capability-catalog 词表跟进。
3. slash command description 改 thunk（datasets/mission/lab/eval）。
4. profiles YAML `persona` → `personaPrefix`/`personaSuffix`。
5. 全仓对 rc.1 编译 + 测试摸底。

### 第二批：ui-file-preview / file-preview（S1 退役，收益最大）

- **删**：DOM 拦截三件套（mention capture 拦截等）、预览抽屉（`shell.overlay`）、turnTail `priority: -1` 抢占。
- **留**：host 采集器（bash 写入捕获，S2 未落地）+ fold `list`；turnTail 回合卡片（含 bash 捕获，比官方 deliverables 数据全，`present` 工具普及后再评估）。
- **新**：文件列表 + 改动记录（逐次 write/edit diff 步进，官方无对应物）做成 page-type 右栏 tab；点击文件 `openResource('dsh-resource://file/session/<id>/<path>')` → 同 pane 官方 document tab 渲染（Markdown/JSON/CSV/图片/HTML 全白捡）。
- **边界**：工作区外的 bash 产物造不出官方地址，降级为仅列表不可点或自绘预览。
- seam registry S1 标「已退役」，写明退役版本。

### 第三批：入口归位

- **worktrees**：badge → `conversation.session.header.corner`；diff/commit 抽屉 → 右栏 tab 类型。
- **taskpilot**：composer 胶囊不动；详情抽屉 → 右栏 tab（会话级，不走全局 panel）。
- **room**：保持 `conversation.view` 不动（名册 / 任务板是协作主界面，非阅览辅助；右栏是阅览语义，全局 panel 是 root 级整页替换，两边都不符）。现有 composer / 胶囊维持。
- **mission**：保持 `conversation.view`（mission 是工作台面而非阅览面，runs 与会话绑定）。全局 panel 预留给未来的真正跨会话总览（如 mission 全局 dashboard），现在不强行消费。
- **local-files（已定 A 方案）**：保持 `conversation.view` tab 不动，只把「打开目录 / 在 IDE 打开」接到官方 open-in-app 探测，恢复 0.1.2 上隐藏的手势。ui-file-preview、worktrees 的 external-open 同此通道。
- **local-agent MemberComposer / room RoomComposer**：composer seam（`conversation.composer` chain + `conversation.input.*` + `useInput`/`inputActions`）baseline 已有，room-composer-parity 提案现在即可开工，不依赖本提案其余项。

### 第四批：能力层切换

- local-agent-tool-subagent 子 agent 登记 → `establishCatalogChild()` + `subagent/catalog`。
- 构建链 → `@deepseek-ai/dsh-typert-generator` npm 包（先实测社区仓布局）。
- local-files / file-preview 大文件分页 → `ctx.fs.readByteRange`。
- context-clearing 提案所依赖的 `surfaceOp: replace` 已是官方正式机制，可推进。
- ankh-guard：借写所有权租约语义（`SessionOwnershipLostError`）巩固重启安全；guard 过滤逻辑保留（S14 未落地）。
- taskpilot / room 流式：评估 `assistant-stream` follow frames（带 attemptId/revision）。

### 明确不做

- 任何依赖 S2/S3/S4/S8/S12/S13/S14 的改造（未落地，见现状）。
- local-files 整体搬右栏（B 方案）：纯搬位置不减维护面，预览组件仍须自留（内置渲染器不可复用已实测确认）；先看 A 方案落地后的使用反馈。
- inline-html-render 不动（官方代码块内联预览已回退）；message-timeline / context-guard / ui-shortcuts / session-title-edit / whalesong 不动。
- Agent Teams：只评估不依赖（experimental，无稳定性承诺）；room 长期方向对照评估另立记录。

## 里程碑

- **M1**：第一批 breaking 适配全绿（rc.1 编译 + 测试）。
- **M2**：动工前实测清单跑通（见验收标准）+ 第二批 ui-file-preview 改造完成，S1 退役。
- **M3**：第三批入口归位（worktrees / taskpilot 右栏 tab；local-files A 方案；room / mission 保持 `conversation.view`）。
- **M4**：第四批能力层切换。

## 验收标准（done 判定）

- 动工前实测（dev profile / rc.1）：第三方 page-type tab 注册与卸载复归全路径；自我们的 tab `openResource` 工作区文件 → 官方 document tab 认领渲染；`openRightbar(fullscreen)` 触发条件；工作区外产物降级表现。
- 每批以独立插件交付（`dsh plugin add/remove` 可用、可热卸载），minHost 随切换点前移至 0.1.5-rc.1 的包更新 README Compatibility + `dsh.compat`。
- seam registry S1、S5（实测通过后）标「已退役」并写退役版本。
- 3080 走标准 `pnpm deploy:3080` 验收门。

## 风险 / 放弃的东西

- typert generator 独立包假设双面 tsconfig 聚合布局，社区仓跑不通则维持借官方 checkout 的现状（S5 标部分退役）。
- 官方 document preview 无 diff 历史概念，改动记录视图长期自留；若官方后续吸收，再退役。
- 全局 panel 无官方范例（shipped composition 零注册），本期不消费；未来跨会话总览类页面要做时先做一个探针包验证 root 级行为。
- rc → 正式版之间官方仍可能回退个别面（消息编辑已有前科），每批评测以实际落地的 rc/正式 tag 为准。
