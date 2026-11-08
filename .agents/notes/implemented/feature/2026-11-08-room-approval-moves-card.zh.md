# Agent Note: 回答工具审批后，运行卡片挪到审批下面

Status: implemented

## Problem

CLI 成员的模式工具需要人批准时，房间里出现一行「允许 / 拒绝」（[运行卡片浮动](2026-10-27-room-running-card-floats.zh.md)：提出审批不挪运行卡片，需要人处理的那一行保持在最后）。人回答之后成员接着干活，但它的运行卡片仍在审批行上面，回答之后的输出长在人刚操作的位置上方。房间时间线设计把审批算作交互点（这一轮吸收了人的输入）；第 E2 步（待定 7，先做 B）。

## Decision

- `answerApproval` 在 `room/approval-resolved` 之后立刻为运行中的成员写 `room/run-moved`（`floatRunningCards`），卡片从审批行下面接着长。提出审批仍然不挪任何东西。
- 只挪卡片，这一轮的文字不在审批处切开。切文字需要在审批上记下切点（`before` 尾巴），留到插话加 `room/speech.marks` 时一起做（设计 F 节）。
- 不加事件类型或字段：`room/run-moved` 是现有的挪位边。

## Alternatives considered

- **审批处也把回复文字切开**（待定 7 的 A）：要给 `room/approval`、`room/speech` 加可选字段；推迟到需要同一机制的插话工作。
- **审批不动**（待定 7 的 C）：回答后的输出继续长在人的操作上方——正是本设计要消除的阅读位置断裂。
- **只挪提出审批的那个成员的卡片**：`floatRunningCards` 让所有运行卡片都在最新发生的事下面，回复和人类消息早已按这条规则；只挪一张，会让另一个成员的卡片停在一个比它晚的回答上方。

## Consequences

- 没经过人就结束的调用（取消、这一轮停了）不挪卡片；这一轮本来就要结束了。

## Testing

`tests/approvals.host.spec.ts`：提出审批的成员在运行时，提出审批不写挪位；人回答后，在 `room/approval-resolved` 之后为该成员写 `room/run-moved`。
