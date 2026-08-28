# Agent Note: Product roadmap inserts a capability layer between base and domain

Status: implemented

[English](2026-08-28-roadmap-capability-layer.md) | 中文

## Problem

21 个在册提案、23 个包，却没有一份上位文档说明某个能力属于哪一层、什么时候做。每个提案各自划定范围，于是「这个包服务 eval 还是 dev」只能逐提案回答，答案彼此不一致。

[package-management](../../../../proposals/active/2026-08-21-package-management.md) 的分类是三层——`base` / `domain` / `ops`，主标签唯一、边界包取基础层。这条规则把一批包放错了位置：local-agent 家族、`mission`、`lab`、`datasets`、`worktrees`、`room`。它们需要外部依赖（PATH 上的 CLI、docker daemon、文件系统约定），所以不是「装上界面就更好用」的体验包；而每一个都被不止一个 workflow 消费，所以没有单一 domain 拥有它们。把 `mission` 归 `base`，等于把一台任务状态机塞进承诺「更好的聊天界面」的整合包；归 `domain`，则被迫在 eval 与 dev 之间做一个假选择。

## Decision

`docs/roadmap.md` 是上位文档：提案说明一个能力怎么建，路线图说明它落在哪一层、被哪个 domain 消费、什么时候做。它包含包账本（每个包的版本、发布状态、一句话能力、相关提案）、一份约束未来提案的决策清单，以及优先级表。

包分类变为四层。`capability` 位于 `base` 与 `domain` 之间，收纳带外部依赖的可复用原语。`base` 保持原有承诺——装上就更好用，无需外部配置。`domain` 退化为纯组合：`base` 加若干 capability，至多再加一两个 UI 包，因此新增一个 domain 不产生新代码。`ops` 不变。

命名三个 domain：`dev`（日常在用的软件工作台）、`eval`（harness 对比）、`novel`。`dsh-dev` 首发。两个已具备条件的 domain 相交于 local-agent 家族与 `mission`，因此发布阻塞点是这个交集，而不是其中任一 domain。

路线图同时记录八条约束未来提案的既定决策，其中包括：dsh 是唯一工作台外壳、AgentOS 冻结为设计资产；本地与远程是 local-agent 家族的一个执行目标维度，而非两套工作台；多人协作的上限是每人一实例加共享数据面，因为 harness 的信任模型把任何连上的调用方视同本机用户；判定不进插件，`lab` / `mission` / `datasets` 只记录事实、不给分。

## Alternatives considered

**维持三层，把共享包归入 `base`。** 否决：`dsh-web-basic` 就是基础整合包，把 local-agent 家族加进去意味着入门整合包要求安装外部 CLI 并逐个登录。基础层的承诺和能力层的承诺，对用户是两种不同的承诺。

**维持三层，只在文档里把 `base` 内部分组。** 否决：分类的用途正是让 domain 包据以组装。只活在 README 里的分组，仍然要求组装者逐包挑选，而那正是分类本该消除的工作。

**不设上位文档，让每个提案各自划定范围。** 否决：这正是产生冲突的现状。21 个提案已经在「`mission` 服务 eval 还是 dev」上彼此不一致，且无人仲裁。

**先出 `dsh-eval`**，即 package-management 原定计划。搁置而非否决：eval 的价值要等一轮对比跑完才兑现，而 dev 是已经在日常使用的形态、反馈立即回流。这个选择不改变关键路径——共享的 capability 层同时阻塞两者——所以它是排序偏好，不是结构判断。

## Consequences

domain 包不产生新代码，因此第四个 domain 只是一次组装练习。[mode-switcher](../../../../proposals/active/2026-08-26-mode-switcher.md) 由此获得确切含义：mode 就是 domain 的 UI 表达。

package-management 的分类落点小节现已过时，需要为 `dsh.category` 增加 `capability` 取值；路线图头部登记了这个联动，提案本身尚未修改。`dsh-web-basic` 当前包含 `ankh-guard` 这个 `ops` 包，四层模型让这一矛盾显形；路线图把它挂为待决而非就地解决，因为改动已发布整合包的成员清单有真实代价。

路线图需要维护：新提案在包账本补一行，发布状态变化时更新标记。优先级的日常变动记在路线图里，不回写本文件；本文件只拥有分类决策本身。两个提案（`capability-catalog`、`mode-switcher`）在主工作树尚未提交，因此路线图引用它们时不建链接，待其进入 main 后补上。
