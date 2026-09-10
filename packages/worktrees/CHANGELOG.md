# 变更记录

## Unreleased

迁移至宿主 0.1.5 的右栏体系，并按活体试用反馈调整改动视图语义。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` 的用户请停留在 `0.1.0-rc.9`
- 改动抽屉（`shell.overlay`）整体退役，改为官方右栏的 page-type tab：类型注册进 `ctx.sidebarRightTabs`（kind `worktrees`），body 进 keyed `sidebar.right.pane.tab` 槽位；徽标点按经 `ctx.sidebarRight.openTab` 打开，导航参数带初始档位
- 改动档语义定为**工作树待提交**：当前选中工作树的全部未提交改动，跟随顶部 worktree 切换器。曾短暂落地过「本会话改动」（git 未提交 ∩ file-preview fold 会话触碰集合），因会话级提交记录拿不到可靠接口由用户拍板回退；fold 探测/降级代码随之移除，两包恢复互不依赖
- 徽标留在 `conversation.session.header.utilities`（order -20，最左）：0.1.5 的 header corner 是 single 槽且已被官方 ExpandButton 占用，single 槽语义为遮蔽，无法共存
- 「在文件夹中显示」手势改走官方 open-in-app 路由探测（GET `/open-in-app/apps` + POST `/open-in-app/open`，仅目录），恢复 0.1.2 上被迫隐藏的手势
- 新增 `@deepseek-ai/dsh-client-ui-sidebar-right` peer 依赖
