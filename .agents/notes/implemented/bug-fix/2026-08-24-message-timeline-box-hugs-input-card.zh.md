# Agent Note: message-timeline 面板盒贴着聊天输入卡;短列表保持居中

Status: implemented

English | [中文](2026-08-24-message-timeline-box-hugs-input-card.zh.md)

## Problem

面板盒止于整个 `[data-composer-seat]` 顶部。composer 座里输入卡上方还有 dock 卡片(目标/任务/队列),任何 dock 打开都会让座变高、把面板底顶离聊天框——即使静止态时间轴也脱离对话。曾在 3080 上试过短列表贴底(列表贴着输入卡),被用户否掉:日常使用应让短列表在盒内保持居中。

## Decision

- **面板盒以聊天输入卡为底,而非整个座**(`rail-tracker.ts` 的 `measureGeometry`):盒底 = `[data-composer-card]` 顶 − 8px 留白,输入卡上方的 dock 卡片永远不会把时间轴顶上去。标记缺失时依次降级到 `[data-composer-seat]` 顶、再到列底(降级不爆炸)。
- **短列表在盒内保持垂直居中**(`TimelineRail.module.css` 的 `margin: auto` 撑开件);溢出列表从顶部排起、隐形滚动,最底行贴着聊天输入卡——"日常居中,变长后贴着聊天框"。

## Verification

`measureGeometry` 测试覆盖:输入卡上方有 dock 卡片时盒底止于输入卡(忽略 dock)、座顶降级、列底降级(`tests/rail-tracker.client.spec.ts`)。包内全部测试通过,`pnpm build` 全绿。

## Alternatives considered

**短列表贴底**(在 3080 试过、用户否掉):只有 3 行时列表也贴着输入卡,日常观感不对——居中才是静止态该有的样子。

**把整个 composer 座计入居中盒**(更早试过、已回滚):中心下移但刻度仍在消息上方,而且 dock 卡片照样会移动盒子。

## Consequences

短列表照常居中;列表变长后向下填满到聊天输入卡,最底行贴着聊天框。dock 卡片完全不再移动时间轴。
