# Agent Note: 及时 commit、push 前确认——public 仓库的发布节奏与暂存纪律

Status: proposed

[English](2026-08-18-commit-push-and-staging-discipline.md) | 中文

## Problem

本仓库是 public（`github.com:Khorsheed/dsh-plugins`），而现有并发规则恰恰是 public 仓库节奏的反面："Pull before you start; **push when you finish**. … push the same day. Work that exists only locally does not exist."。每次 push 都是用户可见的表面——发布消费者、其他 agent、CI 都看得见——历史日志给出了无协调 push 的代价：

1. **并发回滚误伤**（`faaea68 docs(ankh-guard): restore README supervise/restart/kill-model sections (concurrent-revert casualty)`）：某 agent 已推送的 README 改动被另一个 agent 的 commit/revert 周期卷掉，第三个 push 才恢复。对同一批文件的未协调 push 互相碰撞。
2. **commit → revert → 重做 的噪音**（`36c2caa` → `1294d71 Revert` → `767adb2`）：一次修复产生三个提交；逐个 push 就是三轮公开噪音。
3. **宽暂存把别家 staged 文件卷进错误提交**（`022c022`）：并发 agent 的提交带走了另一个 agent 暂存区的文件（本会话的 proposed Agent Note），消息与内容无关。共享 checkout 里 index 是共享可变状态，`git add -A` / `git add .` / `git add -u` 就是这类事故的机制。
4. **未确认就 push**（`6de6591`）：本会话门禁批次提交未经确认即推送。改动意图是被审过的，但 push 本身正是这条规则该卡的用户可见一步。

"当天 push"规则的本意是防丢活（"Work that exists only locally does not exist"、message-tools 0.2→0.4.7 生产线丢在 `/tmp` 开发里）。**及时 commit 已经提供这层保护**——已 commit 未 push 的提交活在 git 对象里，扛得住 checkout 回滚和 rebase；真正有风险的是*未提交*的工作。"当天 push"的字面要求相对"及时 commit"没有额外收益，却要付公开噪音的代价。

## Proposal

把 AGENTS.md "Multi-agent concurrency" 一节的 "Pull before you start; push when you finish." 条目换成"及时 commit / push 前确认 / 显式暂存"规则（具体 diff 见文末[附录](#附录-agentsmd-diff)）：

- **及时 commit，小逻辑单元。** 每个逻辑变更一绿就提交（现有 "Keep `main` green" 条目保留）。已提交的工作存在于 git、可恢复；未提交的工作才有风险。
- **push 前必须显式确认。** 推送前先问人类（或指定的审批者）。远端是 public；一次 push 就是用户可见的表面。
- **批量 push。** 本地累积绿提交，按获批批次一次推——不按提交逐个推。这封顶公开噪音，也让审批者一次只看一个连贯变更集。自然的批次边界：一条特性/一条工作线完成、一批文档全绿、或工作会话结束。
- **绝不宽暂存。** 禁止 `git add -A` / `git add .` / `git add -u`；永远显式路径暂存，提交前看 `git status` 和 `git diff --cached`。共享 checkout 里 index 是共享状态——宽暂存把别家 staged 文件卷进错误提交（`022c022`）。
- **开始前和 push 前都 `pull --rebase`**（保留原条目前半句）；push 后核验 `origin/main` 按预期前进。
- **`--no-verify` 提交是应急例外**：提交信息里披露、push 前修复被跳过的门禁（`6de6591` 提交就是这套做法）。

暂存半条与[每 agent 一个 worktree 提案](../proposed/process/2026-08-18-per-agent-worktree-isolation.md)互补（worktree = 隔离，本规则 = 发布节奏）；两者改的是 AGENTS.md 同一节，落地时要合并措辞。

## Alternatives considered

### 为什么不保留"当天 push"？

它就是上面四起事故的现状成因，且与 public 仓库现实矛盾：把半成品当天推上去正是碰撞和噪音的来源。它声称的保护（防丢活）已被及时 commit 覆盖，保留它只付噪音、无收益。

### 为什么不"每 commit 一确认"？

逐 commit 确认和逐 commit push 一样吵——审批者整天看 commit 级推送。批量给每条工作线一个确认点、每个批次一次用户可见事件。

### 为什么不用 CI 卡 push 替代确认？

本仓库没有 CI（门禁在 pre-commit 钩子里），而且 CI 只能验"绿不绿"，验不了"此刻该不该推"。确认是人类才有的闸门，CI 替代不了；将来若有 CI，也是叠在这条规则之上，而非取而代之。

### 为什么不只靠"仔细看 git status"隐式禁止宽暂存？

事故证明隐式小心不够：卷走 staged 文件的那次提交，操作者大概率也"觉得自己挺小心"。把禁令和事故写成明文，是"机械执行的规则"与"愿望"的区别。

## Acceptance criteria

- AGENTS.md 按附录 diff 写明：及时 commit、push 前确认、批量 push、只显式路径暂存。
- 观察一周提交：任何提交里没有 `git add -A`/`.`/`-u`；push 均为确认过的批量（push 次数少于 commit 次数）；不再出现并发回滚误伤或错卷 staged 文件。
- 出现的每个 `--no-verify` 提交都带披露理由，且其 push 前已修复被跳过的门禁。

## Risks

- 确认给每个批次加一次往返；无人值守的 agent 可能攒着未确认的提交。缓解：人类在自然检查点（会话结束、批次完成）确认；等待期间已提交工作不会丢。
- 批量 push 让早段某个提交的错误更晚暴露。缓解：批次保持小（一条工作线），push 前 pull --rebase，宁可前推修复、不重写已推送分支。
- 在 AGENTS.md 落地前，规则与现有"当天 push"文字并存，中间期的 agent 会按字面走。缓解：本 note 验收与 AGENTS.md 编辑同批落地。

## 附录: AGENTS.md diff

"Multi-agent concurrency" 一节，把这条：

```markdown
- **Pull before you start; push when you finish.** `git pull --rebase` first, push the same day. Work that exists only locally does not exist.
```

换成：

```markdown
- **Commit promptly; push only after confirmation.** `git pull --rebase` before you start and before you push. Commit each logical change as soon as it is green — committed work exists in git and survives rollback/rebase; only uncommitted work is at risk. The remote is public: every push is user-visible surface, so confirm before pushing and batch pushes (accumulate green commits, push once per approved batch) instead of pushing per commit. Never stage broadly — `git add -A` / `git add .` / `git add -u` are forbidden: the index is shared checkout state and broad staging has swept another agent's staged files into the wrong commit. Stage explicit paths, and review `git status` + `git diff --cached` before committing.
```
