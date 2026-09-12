# Agent Note: 无属主的计划重启报告不应叫醒随机会话

Status: implemented

[English](2026-09-13-ankh-guard-ownerless-report.md) | 中文

## Problem

生产 3080 实测（2026-09-13）：一个**已结束**的评审会话被例行部署重启叫醒了两次。注入的是重启**报告**，而不是中断工作的 continue。机制：部署是从外部 CLI 发起的（实例上没有任何对应的 dsh 会话），重启记录没有 `initiator`；`deliver()` 的属主判断（`record.initiator !== undefined && id !== record.initiator`）对无属主记录一律放行，而文档化的规则"无 initiator 的记录由第一个被创建的根 agent 认领"在用户打开那个已结束会话的瞬间触发——刚创建的 agent 认领了待投递的报告。在 `0d4a0a93` 之前 initiator 是用户名，永远不匹配任何会话 id，所以谁都不会被叫醒（报告也永远送不出去）；改成省略 initiator 后，失败模式从"永不投递"翻转成"投递给无辜路人"。

## Decision

在 `deliver()`（packages/ankh-guard/src/index.ts）里按种类拆分无属主记录：

- **裸计划结果**（只有 `exitAt`/`pid`——无 `unexpected`、无 `compositionRecovered`、无 `error`）：重启由宿主外部驱动，操作者终端已有通报，宿主内没有属主。记录在第一次投递经过时直接了结（`acknowledgeRestartRecord`），不叫任何会话。
- **必须有人知情的诊断**（`unexpected: true` 非计划恢复、`compositionRecovered: true` 回滚、或 `error` 失败）：保留"第一个创建的根 agent 认领"——对崩溃或回滚来说，叫醒路人也好过无声。

合并的 continue+report 路径通过 `owesReport` 继承同一判定：被无属主计划重启打断的会话现在只收到纯 continue，不再是合并消息。

## Alternatives considered

**所有无属主记录都保留首建认领。**否决：这正是本次事故——升级日里每次重启都会叫醒用户第一个打开的（可能已结束的）会话。

**所有无属主记录都静默了结。**否决：非计划恢复或组合回滚将在宿主内无人知晓，而那恰恰是报告最重要的场景。

**把报告路由到固定的"运维"会话。**否决：宿主里不存在这种身份，凭空造一个是比本次修复大得多的产品决策。

## Consequences

从外部 CLI 发起的例行部署不再叫醒任意会话；被挂载的已结束会话保持沉寂。首建认领只为带诊断的记录保留。测试：旧的"自治首建认领"用例翻转为了结语义，另新增覆盖三种诊断变体的用例。restart-context.ts 的模块文档已更新为拆分规则。
