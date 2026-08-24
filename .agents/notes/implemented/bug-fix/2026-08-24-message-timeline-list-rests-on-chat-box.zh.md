# Agent Note: message-timeline 短列表贴在聊天框上,dock 卡片不会把它顶上去

Status: implemented

English | [中文](2026-08-24-message-timeline-list-rests-on-chat-box.zh.md)

## Problem

面板盒止于整个 `[data-composer-seat]` 顶部,短列表在窗口里居中悬浮,而会话流是底部锚定的——阅读位置刻度远高于最新消息。更糟的是,composer 座里输入卡上方还有 dock 卡片(目标/任务/队列),任何 dock 打开都会让座变高、把面板底进一步顶上去,即使在静止态也让时间轴脱离聊天框。

## Decision

- **短列表贴在面板盒底部边缘**而非居中(`TimelineRail.module.css`):自由空间全部收在列表上方(`::before { margin: auto 0 0 }`),阅读位置贴近会话最新消息;溢出列表仍然从顶部排起、底部贴着 composer。
- **面板盒以聊天输入卡为底,而非整个座**(`rail-tracker.ts` 的 `measureGeometry`):盒底 = `[data-composer-card]` 顶 − 8px 留白,输入卡上方的 dock 卡片永远不会把时间轴顶上去。标记缺失时依次降级到 `[data-composer-seat]` 顶、再到列底(降级不爆炸)。

## Verification

`measureGeometry` 测试覆盖:输入卡上方有 dock 卡片时盒底止于输入卡(忽略 dock)、座顶降级、列底降级(`tests/rail-tracker.client.spec.ts`)。包内全部测试通过,`pnpm build` 全绿。

## Alternatives considered

**保持居中但把 composer 计入盒子**(试过、已回滚):列表整体下沉但仍居中——刻度依然在消息上方,用户觉得整体太靠下。

**只在溢出时把列表贴底。** 溢出列表本来就在盒底结束;缺陷是 dock 打开时盒子本身结束在聊天框上方,所以修的是盒底,不是列表对齐方式。

## Consequences

短列表紧贴聊天输入框上方、与最新消息对齐;dock 卡片不再移动时间轴。面板盒仍然排除输入卡本身,时间轴不会覆盖输入区。
