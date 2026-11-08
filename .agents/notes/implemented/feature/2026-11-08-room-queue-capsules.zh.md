# Agent Note: 房间输入框上方只放成员级的队列状态

Status: implemented

## Problem

人发的消息的送达状态显示到回执上之后（[回执 note](2026-11-08-room-message-receipt.zh.md)），输入框上方还在重复同一条消息：协调者的房间投递作为预览行，核心账本的队列（`MemberInboxView`）每个房间轮次一行「协作间派活」外加暂停按钮。房间时间线设计 B 线第 B2 步（待定 3，选 A）。

## Decision

- **胶囊，不是行**（`src/client/queue-capsules.ts`、`RoomQueueCapsules.tsx`，经 `RoomTaskCapsule` 新增的可选 `extra` 位渲染）：每个有排队且有气泡的人类投递的成员一颗「⏳ N 条消息在等 X ↑」（只计数，点击滚到第一条的回执）；`restartFacts.queuePaused` 里的成员一颗「⏸ X 的队列已暂停 · 继续」（继续经核心恢复；拿不到控制时打开成员会话）；协调者有结果待核对或在等对账的投递时一颗「⚠ X 上一轮待核对 · 去核对」（打开它的会话）。
- **只为没有气泡的消息留行**：条带保留宿主的 `next-turn` 队列，以及协调者那些消息还不在日志里的人类投递（原生协调者的直接路径；C1 步再扩展）。
- **local-agent**：`LocalAgentUi.renderRoomMemberInbox` 以 `room` 模式渲染 `MemberInboxView`：去掉房间自己的排队行（`caller: 'room'`）和暂停按钮，其他来源的行、失败和待对账保留。`LocalAgentUi.controlMemberQueue(childSessionId, 'pause' | 'resume')` 支撑「继续」。两者都是可选的，核心较旧时房间退回 `renderMemberInbox`。成员页的队列不变。
- 回执上的「继续队列」用同一个控制。

## Alternatives considered

- **输入框上方照旧列出每条排队消息**（待定 3 的 B）：每条等待的消息会出现两次。
- **完全去掉条带**（待定 3 的 C）：原生协调者还没写进日志的消息就无处显示。
- **「另有 1 条来自成员页在等」胶囊**：房间里的队列副本已经列出这些行，带正文和取消；只链接到成员页的胶囊反而把正文藏起来。没做。
- **改 `renderMemberInbox` 的签名**：新增可选方法能兼容较旧的房间和核心，也不碰别的工作在改的那一行签名。

## Consequences

- 房间里不再提供暂停队列（只提供继续）；成员页两者都有。
- 暂停胶囊只在核心因暂停而压着成员页输入时出现（`CoreLedgers.paused`），沿用 `restartFacts.queuePaused` 原有的定义。

## Testing

`room-composer.client.spec.tsx`：两条有气泡的排队消息 → 一颗「⏳ 2 条消息在等 ada」胶囊，不出现正文，没有条带；暂停的成员有自己的胶囊，点击经 `controlMemberQueue` 恢复。`local-agent` 的 `member-inbox.client.spec.tsx`：房间副本去掉房间行和暂停按钮，保留成员页的行，只有房间行在等时什么都不渲染。
