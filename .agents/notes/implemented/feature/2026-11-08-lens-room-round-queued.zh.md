# Agent Note: Context Lens 显示房间消息排队了多久

Status: implemented

## Problem

人发给忙碌 CLI 成员的消息，要在核心队列里等到成员当前这一轮结束。Context Lens 里这条消息开的房间轮次从消息发出时算起，于是排队一分多钟的一轮，看起来像成员花了一分钟才开始干活。设计稿：`proposals/active/2026-11-08-room-timeline-interaction-order.md` 的 H1 步（用户 2026-11-08 拍板，待定 9 选 A）。

## Decision

人的消息明显排过队时，Context Lens 里房间轮次的标题写「排队 1 分 19 秒后开始」（英文 "queued 1m 19s before it started"）。

- 时长用 Lens 已经读到的数据算：人发的 `room/dispatch` 时间，到这条投递启动的各次运行里最早的 `startedAt`（`packages/context-lens/src/room.ts` 的 `roomQueuedMs`）。
- 不到 3 秒（`ROOM_QUEUED_SHOWN_MS`）算马上送达，什么都不显示；还没有任何运行开始的轮次也不显示。
- 它作为可选的 `room.queuedMs` 放在轮次记录和摘要上，渲染在「房间 → …」来源标签旁边。
- 旧日志不需要处理：每个房间日志里都有投递时间和运行开始时间。

房间 → Lens 契约夹具不变：E1 在回答后写的 `room/run-moved` 不在契约记录的脚本流程里，而且 Lens 本来就不读 `room/run-moved`。

## Alternatives considered

**不加标签（待定 9 的 B）。** 数据现成，困惑是真的；用户选了 A。

**用最晚的运行开始，或每个目标一个标签。** 多目标消息里第一个成员马上开始时，从人的角度看它没有等；取最早开始的一个标签，让标题保持简短。

**再短的等待也显示。** 准入正常只要几百毫秒，标出来是噪音——和房间回执在马上送达时保持安静是同一个理由。

## Consequences

- 阈值（3 秒）是判断；宿主慢到 3–5 秒才准入时会显示一个短等待。
- 标签只在轮次标题上，不在轮次菜单里。

## Testing

`packages/context-lens/tests/room-rounds.spec.ts`（等 79 秒的标出，马上开始的不标）；`packages/context-lens/tests/client-panel.spec.tsx`（分/秒措辞）。
