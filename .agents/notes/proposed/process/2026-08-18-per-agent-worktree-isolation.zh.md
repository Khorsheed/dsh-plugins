# Agent Note: 每 agent 一个 worktree，主 checkout 只收绿 main

Status: proposed

[English](2026-08-18-per-agent-worktree-isolation.md) | 中文

## Problem

仓库 checkout 同时兼任 prod link 的 checkout，于是两个 agent 共享一个 checkout 时无法独立测试和部署：

1. 生产 profile（`$DSH_HOME/profiles/web/package.json`，:3080）把每个包都 `link:` 进仓库 checkout；watchdog 重启 serve 的是该 checkout 当前持有的 `lib/`，不管它是谁的进行中产物。
2. 共享 workspace 意味着 A 的 `pnpm run build` / `pnpm run test` 会编译 B 改到一半的源码，B 的 lockfile 变更可能触发 profile 的 `pnpm install` 并在 A 进行中时重启 watchdog，而一次重启 serve 的是 B 的中间态或 stale 的 `lib/`——于是 A 的部署验证失败，原因完全不在 A 可控范围内。
3. 2026-08-18 观察到的仓库现场：主 checkout 里有未提交的 `context-guard` 源码改动，而 `lib/` 已 stale（00:24 构建，源码 00:58–01:03 才改），新加的未提交 `SettingsCard.tsx` 根本没进 `lib/`；此时任何一次重启都会 serve 这个在途状态，挡住另一个 agent 的部署验证。指南现有的缓解全是社会规则——"coordinate restarts in the open"、"keep `main` green"、"never leave a stale or missing `lib/`"——它们都管不到"B 还没 commit 完"这个窗口。

harness 侧部署指南已经把 worktree 当默认环境（构建顺序契约：worktree 里的第一条命令永远是 `pnpm install && pnpm run build:lib:host`），本仓库实际也在用（`dsh-plugins-wt-local-agent-dsh`），但仓库 AGENTS.md 既没强制也没写明这条规则——本 note 就是要补上这个缺口。

## Proposal

把隔离写成 AGENTS.md（"Multi-agent concurrency" 一节）的明文规则：

- **每 agent 一个 worktree；主 checkout 只收绿 main。** 每个 agent 在自己的 worktree（`git worktree add ../dsh-plugins-wt-<topic> -b <branch>`）里改代码、构建、测试；谁都不许在主 checkout 里改源码。主 checkout 只接收绿 `main`（pull/merge），`lib/` 只从合并后的绿 `main` 重建，这样 prod 的 `link:` 永远解析到可部署状态。
- **新 worktree 引导契约**（与 harness 指南一致）：第一条命令是 `pnpm install && pnpm run build:lib:host`——host 面先于 client 面，因为 client 面的 tsc 消费生成的 `./typert`/`./remote` 产物，顺序错了会报一堆误导性错误。
- **验证拆分**：合并前的运行时验证走 scratch 测试 profile（tarball 或指向 worktree 的 link），绝不把在途工作写进主 checkout 的 `lib/`、也不改 prod profile 的指向；:3080 线上实例只验证合并后的绿 `main`。
- 被替换的旧规则里仍然成立的部分保留：不在 `/tmp`/`scratch/` 一次性目录开发、每次提交前 keep `main` green、包级 ownership、restart 公开协调。

可直接应用的 AGENTS.md 具体 diff 见文末[附录](#附录-agentsmd-diff)。

## Alternatives considered

### 为什么保留共享 checkout + 纯社会纪律？

这正是产生本次事故的现状。"coordinate restarts in the open" 和 "never leave stale `lib/`" 管的是两次提交之间的时刻；故障窗口恰恰是未提交的中间态，任何社会规则都保证不了它。不选，因为它就是当前失效的机制本身。

### 为什么不用"包级 ownership 锁"替代 worktree？

包级 ownership（改包前查 `git log`）防的是某个 agent 静默覆盖另一个的方向，但对共享构建和共享的 prod-linked `lib/` 毫无作用：两个 agent 在不同包上照样互相编译对方的在途源码、照样共享一个重启即被 serve 的 `lib/`。它解决的是另一个问题，作为补充保留，不替代隔离。

### 为什么不能只要 scratch 测试 profile、不要 worktree？

scratch profile 解决的是合并前运行时验证，但 A 的 `pnpm run build` / `pnpm run test` 仍然跑在共享 workspace、仍然编译 B 的在途源码；构建污染和 lockfile/重启 churn 依旧。它是必要补充（验证不许碰 prod），不是隔离的替代品。

### 为什么不把 prod profile 在开发期间指到 worktree？

改共享 prod 状态正是这条规则要消除的那种协调性变更 churn，换个名字把同样的危害造回来。prod profile 钉死主 checkout；线上验证是合并后 `main` 的活动。

## Acceptance criteria

- AGENTS.md 的 "Multi-agent concurrency" 一节按附录 diff 写明每 agent 一个 worktree、主 checkout 只收绿 main、以及引导契约。
- 主 checkout 的工作树任何时刻都不带在途功能改动——只有合并提交和合并后的 `lib/` 重建；新 worktree 用 `pnpm install && pnpm run build:lib:host` 引导后构建/测试全绿，且不碰主 checkout。
- :3080 重启只 serve 合并后的绿 `main` 的 `lib/`；"A 被 B 未提交状态挡住"的 stale/在途故障模式不再出现。

## Risks

- 每 agent 多一个 checkout：磁盘 + 每个 worktree 一次 `pnpm install`（node_modules 不跨 worktree 共享）。本仓库事实上已如此；可接受。
- worktree 共享同一个 `.git`；需要每 worktree 一个分支的纪律，合并协调仍走现有的 pull-before / push-when-finished 规则——这条规则加的是隔离，不是分支卫生。
- 每次合并后、重启前必须重建主 checkout 的 `lib/`；旧的 "never leave a stale or missing `lib/`" 收窄到合并后窗口，比现在更小。

## 附录: AGENTS.md diff

把 "Multi-agent concurrency" 一节里的 "Never develop in `/tmp`..." 和 "Prod links here." 两条换成下面内容（"…" 行表示中间的未改动条目）：

```markdown
- **One worktree per agent; the main checkout is deploy-only.** Add `git worktree add ../dsh-plugins-wt-<topic> -b <branch>` and do all editing, building, and testing there — never edit source in the main checkout. The main checkout only ever receives green `main` (pull/merge), and its `lib/` is rebuilt only from merged green `main`, so a restart always serves a deployable state. First command in a fresh worktree: `pnpm install && pnpm run build:lib:host` (host face before client face — build contract below). Pre-merge runtime verification happens against a scratch test profile (tarball or worktree link), never by writing in-flight work into the main checkout's `lib/` or re-pointing the prod profile.
- **Never develop in `/tmp`, `scratch/`, or any throwaway directory.** A message-tools production line (0.2→0.4.7) was lost this way. A worktree of this repo (or a sibling path next to it) or nowhere.
- **Keep `main` green.** Before every commit: `pnpm run build && pnpm run test` for the packages you touched. Commit each logical change separately as soon as it is green.
…
- **Prod links the main checkout.** The production profile (`$DSH_HOME/profiles/web/package.json`, port 3080) `link:`s these packages at the main-checkout path. `pnpm install` in the profile can trigger a watchdog restart, and a restart serves whatever `lib/` the main checkout currently contains — under the worktree rule, always merged green `main`. Rebuild `lib/` after every merge; coordinate restarts in the open.
```
