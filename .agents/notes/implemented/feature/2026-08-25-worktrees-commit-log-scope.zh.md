# Agent Note: worktrees 仓库级提交记录、未跟踪文件行数、分支标注

Status: implemented

English | [中文](2026-08-25-worktrees-commit-log-scope.zh.md)

## Problem

提交记录 Tab 只显示 `base..HEAD`(领先 main 的提交),所以分支合并/追平后就清空了。未跟踪文件打开时没有 `+/-`(git 对新文件没有相对 HEAD 的 diff),也没有明显的"哪个分支"信号。

## Decision

- **提交记录 = 仓库日志**:`commitLog` 现在执行 `git log --format=<...>%D --name-only -n 200 HEAD` —— 该 checkout 的全部历史(合并后也保留),上限 200,并把 `%D` 装饰解析成每行的 `branches` 标注。
- **未跟踪文件行数**:在 `changes` 里,未跟踪(`??`)文件的 `additions`/`deletions` 来自 `git diff --no-index --numstat /dev/null <path>`(新文件内容全是新增,删除=0)。新增容错的 `gitAllowFailure` 辅助函数容忍 `--no-index` 在存在差异时返回的 exit-1。有 200 个未跟踪文件的上限。
- **已提交段保留**:它是分支相对 main 的文件级 diff,与提交日志不同。
- **提交正文**:提交详情在拉取所选提交文件的同时也抓正文(`git show --format=%b`),并渲染在标题下方。

## Verification

在 `~/code/dsh-plugins` 上 `commitLog` 返回 200 行并带 `branches`(`HEAD -> main, origin/main`);未跟踪的 `room-redesign-card.html` 报 `+466 −0`。`git.spec`/`service.spec` 已按新字段与作用域更新;32 个测试通过,build 绿,translation pairing 同步(新增 `commits.recent` 键,双语)。

## Alternatives considered

- **`git log --all`.** 更宽,但难以限定与标注;本 checkout 的 HEAD 历史是自然的"仓库记录"。
- **去掉已提交段。** 丢了分支文件 diff;保留,因为它与提交日志不同。

## Consequences

提交日志不再因合并而清空,每行标注其分支/标签,未跟踪文件显示新增行数。仅展示层 + 数据面。
