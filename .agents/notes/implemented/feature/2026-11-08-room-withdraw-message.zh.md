# Agent Note: 在回执上撤回还在排队的人类消息

Status: implemented

## Problem

人是在消息的回执上（[回执 note](2026-11-08-room-message-receipt.zh.md)）发现它还没送到成员的。原来唯一能收回的地方是成员页的队列，那里这一行只写着「协作间派活」。房间时间线设计 B 线第 B3 步（待定 4，选 A：撤回放在回执上）。

## Decision

- **房间服务新 Remote `withdrawDelivery({ sessionId, dispatchSeq, memberId })`**。只有仍在 `queued` 的人类投递能撤回；已准入或已结束的一律以新失败码 `not-queued` 拒绝。服务先写 `room/delivery-state cancelled`，`text: WITHDRAWN_TEXT`（'人撤回了这条'，`src/delivery-notes.ts`）——已有事件类型和它已有的可选字段——再让派发引擎把这条投递从队列里拿出来。
- **CLI 成员**：`DispatchEngine` 在每条 CLI 投递于核心排队期间保留它的 abort 控制器（`queuedStops`，准入时移除）。`withdraw()` 触发 abort，local-agent 现有的 abort 路径取消排队的账本行——和成员页「取消这条」是同一个核心动作。
- **房间自己的 agent**：它的投递在房间自己的链上排队；`run()` 本来就会丢掉排队期间已结束的投递。
- **不重复记结局**：一条从未被准入、日志里结局已是终态的投递，`run()` 不再追加任何记录，所以核心的 'cancelled' 结算不会再写第二条边或运行行。
- **回执**：撤回（单个收件人）或「撤回给X的」（多个收件人，每个仍在排队的收件人一个按钮）。之后这一行写「已撤回 · 没有送到 X」；被拒时就地显示「已经送到，撤不回了」。

## Alternatives considered

- **只能去成员页撤回**（待定 4 的 B）：人是在时间线上发现问题的，让他去别处操作，正是本设计要消除的困惑。
- **经成员页的控制（`controlMemberInbox cancel`）取消核心行**：浏览器得拿到核心行的 id 或 key，房间日志还要靠这一轮失败才跟上；先写日志、再中止房间自己的句柄，房间的记录才是权威，措辞也是房间自己的。
- **删掉或隐藏气泡**：房间日志只追加，消息确实发过；由回执写明已撤回。

## Consequences

- 撤回的消息留在房间日志里。协调者之后换成原生 dsh 时，它的历史里会有这条消息、没有「已撤回」标记（设计里已接受的风险）。
- 浏览器渲染到点击之间刚好被准入的投递会被拒（`not-queued`），绝不会被中途停掉。

## Testing

`real-core.host.spec.ts`（真实 local-agent 核心）：一轮在跑、两条排队时，已准入的那条被拒；第二条撤回成功（一条带 `WITHDRAWN_TEXT` 的 cancelled 边、核心行已取消、没有自己的运行），第三条照常接着跑，提示里只有它自己的话。`receipt.client.spec.tsx`：撤回按 dispatch seq 和成员 id 调用，被拒时就地显示原因。
