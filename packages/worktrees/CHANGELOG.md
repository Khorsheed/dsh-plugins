# 变更记录

## 0.3.1（2026-09-30）

- 补发以带齐宿主 0.2.0 兼容：npm 上的 `0.3.0` tarball 早于 peer 区间加宽（`|| ^0.2.0-rc.1`），宿主 0.2.0-rc.* 的兼容性检查会拒绝它。无功能变更。

## 0.3.0（2026-09-27）

- **BREAKING（包结构）**：伴生包 `@khorsheed/dsh-worktrees-tool` 回并进本包——模型工具行改由本包的 `./tool` 子路径导出承载（`name: '@khorsheed/dsh-worktrees/tool'`，行 id 仍为 `worktrees-tool`，preset 组合里的行 id 不变、组合状态不受影响）。迁移：preset 的 `agent.cordis.yml` 里把 `name: '@khorsheed/dsh-worktrees-tool'` 改为 `name: '@khorsheed/dsh-worktrees/tool'`，并卸载旧伴生包（旧包名已在 npm deprecate）。工具定义工厂 `defineWorktreesTool` 从 `./tool` 出口退到内部模块 `./tool-definition.ts`——`./tool` 现在是可直接挂载的行模块（`name` / `inject = ['worktrees']` / `apply`），这是 2026-09-11 拆分记录里标记为「loader 支持子路径行后即可回并」的既定终点（canvas `./agent` 先例已验证该形态）。
- 徽标/tab 的 preset 组合判据常量同步指向 `@khorsheed/dsh-worktrees/tool`。
- 工具 origin 归因 owner 归一到本包名 `@khorsheed/dsh-worktrees`。

## 0.2.1（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2；rc.1→rc.2 无触及本包的宿主变更，全量构建+测试双绿）。无功能变更。伴生工具行 `@khorsheed/dsh-worktrees-tool` 0.1.1 修复 rc.1 挂载顺序下工具行静默惰死（核心服务改声明式 inject，见其 CHANGELOG）。

## 0.2.0（2026-09-26）

首个公开发布。

- 详情面板标题行新增「重新加载」手势（共享内容面板的 `onReload`）：重读当前文件的当前视图——diff 档重拉 `fetchFileDiff`，内容/图片档重走 read Remote；重读期间旧内容保持显示、按钮禁用并旋转图标，失败保留旧内容并报进既有 error 槽（成功臂顺带清掉旧 error，local-files `setPreview` 同惯例）；晚于选择变更到达的旧答案按详情键丢弃。提交详情页（CommitDetails）不接——文件钉死在那一提交，内容不可变

迁移至宿主 0.1.5 的右栏体系，并按活体试用反馈调整改动视图语义。另按单实例多模式提案（2026-08-26）拆出模型工具行、徽标显隐改读官方组合数据。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` 的用户请停留在 `0.1.0-rc.9`
- **BREAKING**：模型可见的 `worktrees` 工具不再由 core 在 profile 根注册——工具拆为伴生包 `@khorsheed/dsh-worktrees-tool`（不 `ctx.provide`、不声明 `dsh.bundle` 的不自挂载行），由各 agent preset 的 `agent.cordis.yml` 按名引用、按会话授予。迁移：安装伴生包并在目标 preset 加 `- id: worktrees-tool / name: '@khorsheed/dsh-worktrees-tool'`（web-dev 的 dev preset 已带此行）；工具定义工厂 `defineWorktreesTool(service)` 经 core 的 `./tool` 导出供伴生包复用，业务实现零复制
- 徽标显隐默认判据从 `visiblePresets` 手配名单改为**官方 `pluginInventory` 组合数据**：当前会话的 preset 组合里有 `@khorsheed/dsh-worktrees-tool` 行则显示、没有则隐藏；`visiblePresets` 保留为手动 override（配了名单用名单）；组合数据不可得或无 preset 的会话 fail-open 显示
- 改动抽屉（`shell.overlay`）整体退役，改为官方右栏的 page-type tab：类型注册进 `ctx.sidebarRightTabs`（kind `worktrees`），body 进 keyed `sidebar.right.pane.tab` 槽位；徽标点按经 `ctx.sidebarRight.openTab` 打开，导航参数带初始档位
- 改动档语义定为**工作树待提交**：当前选中工作树的全部未提交改动，跟随顶部 worktree 切换器。曾短暂落地过「本会话改动」（git 未提交 ∩ file-preview fold 会话触碰集合），因会话级提交记录拿不到可靠接口由用户拍板回退；fold 探测/降级代码随之移除，两包恢复互不依赖
- 徽标留在 `conversation.session.header.utilities`（order -20，最左）：0.1.5 的 header corner 是 single 槽且已被官方 ExpandButton 占用，single 槽语义为遮蔽，无法共存
- 「在文件夹中显示」手势改走官方 open-in-app 路由探测（GET `/open-in-app/apps` + POST `/open-in-app/open`，仅目录），恢复 0.1.2 上被迫隐藏的手势
- 新增 `@deepseek-ai/dsh-client-ui-sidebar-right` peer 依赖
