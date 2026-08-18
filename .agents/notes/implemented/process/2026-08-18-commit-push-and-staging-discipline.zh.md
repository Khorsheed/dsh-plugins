# Agent Note: 及时 commit、push 统一安排——public 仓库的发布节奏与暂存纪律

Status: implemented

[English](2026-08-18-commit-push-and-staging-discipline.md) | 中文

## Problem

本仓库是 public（`github.com:Khorsheed/dsh-plugins`），而仓库成立之初继承的并发规则恰恰是 public 仓库节奏的反面："Pull before you start; **push when you finish**. … push the same day. Work that exists only locally does not exist."。每次 push 都是用户可见的表面——发布消费者、其他 agent、CI 都看得见——历史日志给出了无协调 push 的代价：

1. **并发回滚误伤**（`faaea68 docs(ankh-guard): restore README supervise/restart/kill-model sections (concurrent-revert casualty)`）：某 agent 已推送的 README 改动被另一个 agent 的 commit/revert 周期卷掉，第三个 push 才恢复。
2. **commit → revert → 重做 的噪音**（`36c2caa` → `1294d71 Revert` → `767adb2`）：一次修复产生三个提交；逐个 push 就是三轮公开噪音。
3. **宽暂存把别家 staged 文件卷进错误提交**（`022c022`）：并发 agent 的提交带走了另一个 agent 暂存区的文件（本会话的 proposed Agent Note），消息与内容无关。共享 checkout 里 index 是共享可变状态，`git add -A` / `git add .` / `git add -u` 就是这类事故的机制。

"当天 push"规则的本意是防丢活（"Work that exists only locally does not exist"、message-tools 0.2→0.4.7 生产线丢在 `/tmp` 开发里）。**及时 commit 已经提供这层保护**——已 commit 未 push 的提交活在 git 对象里，扛得住回滚和 rebase；真正有风险的是*未提交*的工作。"当天 push"的字面要求相对"及时 commit"没有额外收益，却要付公开噪音的代价。

## Decision

AGENTS.md "Multi-agent concurrency" 第一条现已改为（原文照录）：

> **Pull before you start; push when arranged.** `git pull --rebase` before you start; commit each logical change as soon as it is green (committed work exists in git). **Pushes are coordinated by the human, not a same-day obligation** — never push unilaterally. Stage explicit paths only (`git add -A` / `git add .` / `git add -u` are forbidden: the index is shared checkout state, and broad staging has swept another agent's staged files into the wrong commit); review `git status` + `git diff --cached` before committing.

决定分四部分：

- **及时 commit**：每个逻辑变更一绿就提交；已提交的工作活在 git 里，等 push 期间安全。
- **push 统一安排**：由人来安排批次何时出去；"当天"消失——既不是当天义务，也不是 agent 的擅自行为。
- **只显式路径暂存**：禁 `git add -A` / `git add .` / `git add -u`；提交前看 `git status` 和 `git diff --cached`。
- `git pull --rebase` 仍在开始工作前（以及任何 push 前）执行。

## Alternatives considered

### 为什么不保留"当天 push"？

它就是上面三起事故的现状成因，且与 public 仓库现实矛盾：把半成品当天推上去正是碰撞和噪音的来源。它声称的保护（防丢活）已被及时 commit 覆盖，保留它只付噪音、无收益。

### 为什么不"每 commit 一确认"？

逐 commit 确认和逐 commit push 一样吵——审批者整天看 commit 级推送。统一安排的批次给每条工作线一个确认点、每个批次一次用户可见事件。

### 为什么不用 CI 卡 push 替代统一安排？

本仓库没有 CI（门禁在 pre-commit 钩子里），而且 CI 只能验"绿不绿"，验不了"此刻该不该推"。与人的协调是 CI 替代不了的闸门；将来若有 CI，也是叠在这条规则之上，而非取而代之。

### 为什么不只靠"仔细看 git status"隐式禁止宽暂存？

`022c022` 的卷包证明隐式小心不够。把禁令和事故写成明文，是"机械执行的规则"与"愿望"的区别。

## Consequences

- 仓库不再指示当天 push：agent 及时 commit、等人类安排；公开噪音收敛为安排的批次。
- 暂存规则封掉了把别家 staged 文件卷进错误提交的共享 index 隐患（`022c022`）。
- 旧规则前半句（"Pull before you start"）保留；"Work that exists only locally does not exist" 删除——其防丢活的意图由及时 commit 承担，不由 push 承担。
- [每 agent 一个 worktree 提案](../../proposed/process/2026-08-18-per-agent-worktree-isolation.zh.md)仍为 proposed，同样改动本节；两者都落地时在那边合并措辞。
- 本批次早前的提交（`6de6591`、`b9ecc41`）在规则落地前已推送——它们是最后两次擅自 push。

## Testing

- 暂存规则与 hygiene 门禁的 staged-set 行为、pre-commit 钩子一致；无代码改动。
- 迁移后的 note 通过 `verify-agent-note-format` / `verify-agent-note-classification`；`verify-translation-pairing` 按新路径重记；`check:hygiene` 对触及文件 0 findings。
