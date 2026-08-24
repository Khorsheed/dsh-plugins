# Agent Note: worktrees 插件——会话 badge + 改动抽屉（纯 git 事实展示）

Status: implemented

[English](2026-08-24-worktrees-plugin.md) | 中文

## 问题

仓库的多 worktree 协作（docs/development.md：worktree → main → 3080）一直没有可见的 git 状态：会话里的 agent 在某个 worktree 干活，其分支、ahead/behind、改动文件、提交只能靠手工跑 git 命令获取，人类更是没有任何可扫视的表面。[worktree-governance 提案](../../../proposals/active/2026-08-23-worktree-governance.md) 把 v1 范围定为"先把 git 事实展示好"——在事实立住之前不做任何治理判定（无全局板、无违规面板、无模型 review、无门禁）。

## 决策

交付一个独立包 `@khorsheed/dsh-worktrees`（host 服务 + Typert Remote + client 半，datasets/mission 单包模式）：

- **Host** `ctx.worktrees`（`src/service.ts`）：只读 git 查询、无状态，registry 就是 `git worktree list` 本身。每条 UI 数据都有具名 git 来源：badge 总数 = `diff --numstat HEAD` + `diff --numstat <base>...HEAD`；文件树两段 = `status --porcelain`（+ `ls-files -o` 的 untracked）与 `diff --name-status <base>...HEAD`，行数由 `--numstat` 合并；仓库浏览 = `ls-files -co --exclude-standard`；提交记录 = `log --format=... <base>..HEAD`；单提交文件 = `show --name-status`；单文件 diff = `diff <range> -- <path>` / `show <sha> -- <path>`。客户端路径一律过 `assertSafePath`（拒绝绝对路径与 `..` 穿越）。
- **Remote**（`src/remote.ts`）：wire namespace `worktrees`，方法从 `agent.session.header.cwd` 解析 repo toplevel → worktree 条目。在 `scripts/gen-typert.mts` 的 `TYPERT_PACKAGES` 注册（共享构建脚本里每个 typert 包都需要的机械登记；无 harness 改动）。
- **Client**（`src/client/`）：badge 挂 `conversation.session.header.utilities`（当前为空槽的右对齐工具区——零冲突），两个可点区（仓库 → 仓库文件档，分支 → 改动档）；抽屉挂 `shell.overlay`（additive id `worktrees-drawer`，order 130——与 ui-file-preview 的抽屉 110 共存），默认折叠；三档（改动档未提交/已提交一个树、提交记录档内联提交文件树、仓库文件档全量浏览）；详情 `改动 | 内容` 双视图（自定义 `DiffView`——官方 `DiffBlock` 画的是整文件新旧两侧，会把 patch 画成"全删全加"；内容用官方 `CodeBlock`）；git 动作行（刷新 / 复制分支名 / 打开目录，host 手势 gate 在 loopback `canOpenPath`）；树默认只展开第一层 + 展开全部/收起全部。
- **仓库约定全部遵守**：identity 三角（cordis.patch.yml 引号名、tsdown `clientBundle(id)`、invariant `PACKAGE_NAME`）、自挂载（`dsh.bundle.patch` 进 `files`）、`dsh.client` 声明、`zod` 进 dependencies（生成的 remote-client 会 import 它——缺了浏览器 bundle 的 require 会在运行时炸）、client 包 peerDependenciesMeta optional、双语 README + Compatibility、degrade-don't-explode（非 git 会话 → badge 隐藏；本地缺 `<base>` → 已提交段跳过；detached HEAD → `detached` 标签）。

## 备选方案

- **先做完整治理层**（全局板、违规面板、模型 review、合并门禁——提案初版范围）：推迟到 M3+——规则引擎判不了意图（main 上有未提交改动是合法的 mainline 工作还是违规？），而且事实没立住之前板子也没用。v1 只渲染事实；模型 review 方向记在提案的后续阶段。
- **仓库浏览跳到 ui-file-preview 的 tab**：它的 tab 是产物浏览、没有文件树——全量浏览是新 UI，所以做成抽屉第三档复用树 anatomy，不重复造 explorer。
- **git patch 用官方 DiffBlock**：它画整文件新旧两侧（旧行全删、新行全加）——patch 需要逐行 unified diff 渲染，因此写了很小的 `DiffView`，用同一套 token 词汇。

## 后果

- 每个会话都能看到自己在哪干活（repo/worktree/branch + diff 数），零官方改动；社区可 `dsh plugin add/remove` 自由装卸（自挂载），`check:plugins`（0 findings）与 `check:hygiene` 机械验证。
- badge 与抽屉都是 additive 槽位消费者；从组合里移除本插件即移除全部表面。
- `scripts/gen-typert.mts` 多了一个已注册包（机械登记，本仓任何 typert 包都需要）。
- 21 个测试覆盖解析器（worktree list、porcelain、name-status、numstat 合并、log）与 service 对真实临时 git 仓库的集成（ahead/behind/dirty、两段、linked worktree 的 isMain、路径安全）。
