# Agent Note: message-timeline 面板宽度封顶到左缘沟槽,沟槽放不下 120px 时整条隐藏

Status: implemented

English | [中文](2026-08-17-message-timeline-gutter-width-cap.zh.md)

## Problem

悬浮时间轴面板始终按配置的固定宽度渲染(`panelWidth`,默认 360px,限 120–640),与会话布局无关。官方聊天列居中且封顶 `--dsh-chat-content-width: 748px`(`ConversationRoot.module.css`),因此滚动区左缘沟槽 = 32px 滚动内边距 + 居中余量——典型宽列下约 220px。锚在滚动区左缘内 6px 的 360px 面板于是越过沟槽伸进消息流,盖住每条消息的开头(1180px 列上约 150px 文字)。由于列宽固定,这个重叠在任何窗口宽度下都存在,不只是窄窗口;按视口比例封顶也修不了(1200px 滚动区的 40% 仍然大于 360px)。

## Decision

面板宽度自适应实测的左缘沟槽;沟槽小到放不下可用宽度时,面板整条隐藏:

- rail tracker 在既有几何之外,新增发布滚动区宽度和消息流左缘(`flowLeftX`:第一条 `[data-chat-flow-kind]` 行的 rect.left,该行紧贴居中列左缘)(`rail-tracker.ts`、`TimelineRailState`)。
- 组件把宽度封顶为 `min(panelWidth, flowLeft − rail.left − 24px)`——16px 可见呼吸间距加面板 8px 右内边距(`PANEL_PADDING_X`)——时间轴文字绝不越过消息流。
- 沟槽放不下最小可用宽度(`PANEL_WIDTH_MIN`,120px,从 `config.ts` 导出)时,面板整条隐藏,而不是渲染一条只会拦截会话内容的细条。
- 流探针未应答(官方结构变化)时,宽度降级为 `min(panelWidth, max(120, 滚动区宽度 × 0.4))`——永不抛错、盖住的范围不超过兜底值。

## Verification

单元测试钉住该策略:宽度封顶到沟槽、沟槽更宽时保持配置宽度、沟槽恰好放得下时按 120px 下限渲染、低于下限时隐藏、`flowLeft` 为 null 时降级到滚动区比例(`tests/TimelineRail.client.spec.tsx`)。tracker 测试覆盖新状态字段与 `flowLeftX` 探针(`tests/rail-tracker.client.spec.ts`)。包的 `pnpm build` + `pnpm test` 全绿(81 个测试)。

## Alternatives considered

**按滚动区宽度比例封顶。** 列宽固定且居中,窗口伸缩时滚动区几乎不变,比例封顶很少触发,也修不了宽窗口下的重叠。

**按视口宽度阈值隐藏。** 窗口宽度与聊天列宽没有直接对应关系(侧栏吸收伸缩);实测沟槽才是真正的约束。

**通过槽位或 CSS 变量在官方布局里预留沟槽。** 需要改 host;本仓库的纪律是走上游变更流程,不做本地 fork。

## Consequences

典型宽窗口下,面板现在在左缘空白区显示约 200px 预览文字,而不是 360px 盖在消息上;配置 `panelWidth` 变成首选上限。极窄列完全失去时间轴(连刻度都没有),代价是这类窗口不再有环境标记,换来永不遮挡会话内容。
