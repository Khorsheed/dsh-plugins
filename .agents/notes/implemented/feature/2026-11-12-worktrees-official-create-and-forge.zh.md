# Agent Note：复用官方工作树创建，不缩小 Worktrees 的职责

状态：implemented

[English](2026-11-12-worktrees-official-create-and-forge.md) | 中文

## 问题

官方 0.2.2-rc.2 worktree 服务能在官方池中创建新分支、把创建事实写入 Session 并切换调用方 cwd。社区 Worktrees 还支持任意路径、采用已有检出、仓库文件编辑、dirty 徽标和受保护删除。整包替换会丢失这些职责，双路径又可能重复创建记录。

## 决策

只有同时具备 Agent、非空新分支名、绝对路径，并且路径精确等于官方文档默认池加该分支时，才调用 `ctx.worktrees.create`。官方 `{ path, branch, baseCommit, repositoryRoot }` 进入工具结果，原会话绑定指向返回的规范化路径。列表、切换、编辑、dirty 展示与受保护删除不变。

官方创建失败后直接报错，不再执行第二次旧创建。任意路径、采用已有工作树、无 Agent 上下文和无官方服务时保留旧实现。本次不启用归档清理，原有删除保护独立保留。

Forge 仅作为评审目的地。页面通过现有 slot-hooks 监听公开 `sidebarRightTabs` 注册表，存在官方 `forge-panel` 时显示入口，不创建第二套 PR 绑定，未安装时隐藏。

## 未采用的方案

**所有创建都走官方服务。** 否决：官方池和新分支约定不覆盖任意路径与采用已有检出。

**官方失败后回退旧命令。** 否决：官方可能已留下部分产物，第二次创建会重复工作并掩盖失败。

**与 Forge 共享 PR 状态。** 否决：本包不承担官方绑定职责，打开现有面板即可。

## 影响

真实官方 harness 创建分支和检出后，官方 Session cwd 与 `plugin:worktree/created` 记录正确，原绑定和返回的基线一致。包测试覆盖元数据、任意路径回退、失败后不二次创建和 Forge 可选入口。

包的 14 个测试文件、119 项测试在 rc.2 通过。生产部署与发布另行决定。

## 相关

- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.md)
- [官方能力整合路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
