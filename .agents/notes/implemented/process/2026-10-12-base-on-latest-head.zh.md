# Agent Note: Development base is the latest local HEAD, not origin/main

Status: implemented

## Problem

AGENTS.md 此前要求每个 agent「开工先 pull」(`git pull --rebase`),这句措辞把 origin/main 当成了新鲜的来源。这个前提在本仓库是倒置的:push 由 human 一事一议,所以本地 main 几乎总是领先 origin/main(2026-10-12 时领先 440 / 落后 0),所有 agent 未推送的提交都堆在本地 main 上。这种状态下 `git pull --rebase` 是空操作,拉不来任何新东西——新工作的最新基线是本地 HEAD,不是远端。这句措辞还掩盖了罕见分叉情形的真实危险:当远端确实有本地没有的提交时,机械 pull-rebase 会把共享检出里全部未推送提交——包括其他 agent 的——逐个重放,把冲突(3ff8a5d8 前后 profiles/web-eval/README* 的重叠,由合并 98234ec3 解决)落在执行 rebase 的 agent 并不拥有的工作上。

## Decision

规则改为「在最新 HEAD 的基础上开发」。开工前:`git fetch origin`,看 `git status -sb`。`behind 0`(常态)——本地 main HEAD 就是最新基线,直接开工,不需要 pull;`behind > 0`——任何 rebase 之前先停下来报给 human/mainline 协调:重放共享的未推送提交栈是协调者的决定,不是 agent 的机械步骤。从本地 main HEAD 切出的 worktree 天然站在最新基线上。已写进 AGENTS.md 多 agent 并发条目与 docs/development.md 「推送与分支保护」。

## Alternatives considered

- **保留「开工先 pull」原样。** 常态下是无害的空操作,但它教的是错误的心智模型(远端=最新),而它真正起作用的唯一情形——分叉——恰恰是无人值守的大规模 rebase 最危险的地方。
- **`behind > 0` 时自动 rebase。** 否决:在没有其他 agent 上下文的情况下重放他们未推送的提交,即使 hunk 干净应用也可能破坏语义;分叉足够罕见,协调成本很低。
- **改为把 worktree rebase 到 origin/main 上。** worktree 从本地 main HEAD 切出,本地 HEAD 已包含远端的一切外加未推送的本地工作;远端提供不了任何新东西。

## Consequences

agent 不再把空操作的 pull 当成新鲜度保证,而是从真正的最新基线开工;分叉情形有了明确的「停下来先协调」规则,取代隐式的大规模 rebase。代价:这条规则的正确性依赖 human 协调推送节奏这一前提持续成立——它已是推送一节的成文前提——以及 agent 在判断 ahead/behind 之前真的先跑 `git fetch`。
