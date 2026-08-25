# Agent Note: worktrees 抽屉拆分改动段并标注未跟踪文件

Status: implemented

English | [中文](2026-08-25-worktrees-drawer-segment-groups.zh.md)

## Problem

改动("改动")Tab 把未提交(相对 HEAD)和已提交(base..HEAD)两个文件列表合并进一个扁平的 `all-changes` 组,所以会话看不出哪些待处理改动是未提交、哪些是已经提交到分支上的。未跟踪(新)文件也出现在同一列表里,但打开后没有 diff 视图(git 对新文件没有 diff),读起来像 bug 而不是"新文件预览"。

## Decision

改动抽屉把文件树拆成两组——未提交(uncommitted)和已提交(committed)——并渲染每段的组头与计数。仓库浏览组不渲染组头(树标题已命名)。对于未跟踪文件,详情面板现在在 CodeBlock 上方显示一条安静说明(未跟踪的新文件 — 无 diff,仅内容),于是"无 diff"读起来是有意为之。`FileTree` 增加了可选的分段组头渲染。

## Verification

`drawer.client.spec.tsx` 仍通过;32 个包内测试与 `pnpm run build` 全绿;translation pairing 同步(新增的 `detail.untrackedNote` 键存在于双语)。

## Alternatives considered

- **只显示未提交。** 会把已提交文件从改动视图移除;单独"提交记录"Tab 已展示分支日志,但这里的已提交文件 diff 有用——拆分两者保留。
- **仅在行上用 `??`/未跟踪状态。** `??` 徽标已存在;说明文字是对"无 diff"情形更清晰的信号。

## Consequences

改动树现在明确显示"未提交 / 已提交";新文件内容作为未跟踪文件预览呈现,而不是空 diff。无数据模型改动——仅展示层。
