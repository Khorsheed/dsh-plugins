# Agent Note: Room store refreshes off the host-pushed live event feed

Status: implemented

[English](2026-08-25-room-live-refresh.md) | 中文

## Problem

客户端 RoomStore 此前只在三种时机刷新：自身发起的 mutation、会话切换、以及仅在成员运行中才启动的 2s 轮询。非 client 发起的 journal 追加——主 agent 的 `room_task`/`room_invite` 工具调用、local-agent 桥接的 `receiveMemberMessage`——要等下一次刷新才出现在 dock 和面板里：agent 正在干活的 room，在旁观看的人类眼里是冻结的。另外，折叠态任务胶囊只渲染光秃秃的未结计数（`☑ 1`）没有标签，挨着带标签的目标胶囊读起来像噪点。

## Decision

RoomStore 订阅当前会话的实时会话流（`ctx.sessions.binding(sessionId).session`，一个 `ObservableSnapshot`），把每次快照通知当作缓存 room 状态的刷新触发，300ms 去抖（`ROOM_LIVE_REFRESH_DEBOUNCE_MS`），让一波事件只花一次 `getState` 拉取。它能成立是因为 host apiproxy 把每个会话事件——包括 `room/*` journal 追加——都以 `session/event` 帧推给 client，client runtime 再把它折叠进会话的 conversation 快照；store 因此能在一拍之内看到 host 侧的 journal 写入，且不新增任何 wire 面。触发仅在已知为 room 的会话上生效（非 room 的快照抖动不上 wire）；每次完成的拉取都会重试 attach（runtime 惰性 mint 会话 binding，可能晚于列表的 current 翻转）；dispose 时退订并丢弃挂起的去抖刷新。自有 mutation 刷新和成员运行中轮询原样保留——实时流取代的是延迟，不是其他触发源。

任务胶囊始终带标签：`当前进度 1/3`——完成数/总数，与目标环读的是同一个 `taskProgress` 口径（cancelled 与 failed 不进分母）；有成员在跑时追加 `· ●ada 在做`；无可计数任务时只显示裸 `当前进度`（不显示 0/0）。标签复用既有 `tasks.capsule` 词条，两个 locale 无需新增键即同步。

## Alternatives considered

- **host cordis 事件转发给 client**（host 上 `ctx.emit('room/journal-updated', sessionId)`，client 上 `ctx.remote.$on`）——否决：cordis 事件到 client 唯一的桥是 harness 固定的 `API_REMOTE_FORWARDED_EVENTS` 白名单，扩展它是 upstream 改动，而这个需求现有 `session/event` 流已经覆盖。
- **在 room Remote 上自建插件推送通道**——否决：Typert Remote 面只有请求/响应，没有可按 namespace 推送的地基。
- **无条件轮询（去掉成员运行中的门）**——否决：让每个打开的 room 永远背一个 2s RPC 去修一个事件流能精准解决的延迟问题，而且实时流让轮询更没必要，不是更必要。
- **更长或纯尾沿去抖**——300ms 尾沿去抖是能合并一次 journal 追加周边事件簇（工具调用、结果、任务边）的最小窗口；持续流式期间，最坏情况仍由（不变的）成员运行中轮询兜底。

## Consequences

- 主 agent 用 `room_task` 加任务，journal 追加后约 300ms 内落到 dock，无需刷新页面；已在 scratch 实例（3199 端口）用前后 dock 截图真机验证（`scratch-screenshots/`）。
- client 规格钉住三条行为：当前 room 的实时流触发每簇恰好一次刷新、非 room 的流被忽略、dispose 退订并丢弃挂起触发（包内 166 测试全绿，新增 3 条）。
- store 的测试 double 现在 stub `ctx.sessions.binding`；生产代码用可选链守护该调用，无 binding 的 double 退化为实时流之前的行为而不是抛错。
