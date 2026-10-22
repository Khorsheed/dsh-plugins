# Agent Note：message-timeline 测高时跳过被隐藏的输入卡片

Status: implemented

[English](2026-10-23-message-timeline-overlay-composer-height.md) | 中文

## 问题

[窄布局刻度条](2026-10-23-message-timeline-narrow-layout-tick-strip.zh.md)上线后，Room 会话里的时间轴仍然出不来：最多在左上角露出几像素的蓝色刻度，打开会话时完整的时间轴会一闪而过。问题出在高度，不在宽度。Room 的输入框以 `overlay: true` 接管 `conversation.composer` 链。宿主没有卸掉官方输入栏，只是给它包了一层 `display: none` 的 fallback 外壳（`ui-renderer` 的 `scoped-slots.tsx`，`data-chain-overlay-fallback`），所以它的 `[data-composer-card]` 仍是滚动容器里第一个卡片标记，而它量出来是 y=0 的零尺寸矩形。`measureGeometry` 把面板底边定在这张卡片上方 8px，高度于是被夹成 0。面板只剩 8px 内边距，`scrollIntoView` 把当前行滚进这点空间，就露出了一截蓝色刻度。一闪而过的那一帧，是 room 输入框还没被选中、原装输入栏仍在布局里的时候。

## 决定

`measureGeometry` 改为取第一个已布局的 `[data-composer-card]`，跳过零尺寸矩形（与 `flowLeftX` 对消息行用的是同一个判据）。没有已布局的卡片时，沿用原有的兜底：先用输入区 seat 的顶边，再用滚动容器底边。Room 因此止于 seat 顶边，即后台 Agent 浮条上方。这可以接受，因为 Room 输入框没有能把浮条和输入框区分开的卡片标记。

## 考虑过的替代方案

**让 room 输入框也带 `data-composer-card`。** 不作为唯一修法：任何 overlay 输入框都会踩同样的坑，而且被隐藏的官方卡片在 DOM 顺序里依然排在前面。

**把查询限定在被选中的 overlay 内。** 否决：`data-chain-overlay-fallback` 是宿主的渲染产物，不是声明过的 API；零尺寸判据不依赖宿主用什么方式隐藏 fallback。

## 后果

Room 及其他 overlay 输入框的会话里，时间轴恢复完整高度。测试覆盖：`measureGeometry` 新增一条用例，在 seat 里放一张零尺寸卡片，断言高度取 seat 顶边。
