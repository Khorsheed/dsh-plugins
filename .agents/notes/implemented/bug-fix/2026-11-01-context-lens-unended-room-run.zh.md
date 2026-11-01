# Agent Note: Context Lens——没有结束记录的房间运行截到该成员的下一次运行

Status: implemented

## Problem

3080 上一个房间会话（协调者是外部 CLI，在写小说）打开 Context Lens 时停在一个空的失败轮次上，而第 36 轮吞掉了之后所有请求：一格里约 150 根柱子，地图以它为中心，其他轮次都看不到，跳转到更早的轮次也没反应。

会话日志里查到三个原因：

- 第 36 轮的成员运行一直停在 `running`——打断它的重启没有写下 `done`/`cancelled`——所以既没有 `endedAt` 也没有 `childTurn`。`roomTurns` 对这种运行按时间窗匹配、窗口截到 `now()`，于是认领了子会话之后的所有请求。这些请求同时也在各自的轮次里，会话趋势把它们算了两遍。
- 列表最后一轮是 ankh-guard 重启跟进开的宿主轮，房间的 pre-step 在调模型前就拒了它。它没有请求、没有人发的消息、没有回复，却成了面板的默认落点。
- 房间轮落在人发的那条消息行上（`data-chat-node-key`），但不像宿主轮那样先往回翻聊天历史：比已渲染窗口更早的轮次够不着。

## Decision

- 没有结束时间的运行，窗口截到同一成员下一次运行的开始（没有就下一次派发，再没有才到现在）；该成员后续运行记为 `childTurn` 的宿主轮的请求，它一律不认领（`InspectorStore.openRunEnd` / `laterChildTurns`）。
- `isHollowTurn`（客户端 aggregate）：0 次请求、query 为空、不是房间轮、没有收尾消息。`latestTurnSeq`、`resolveTurnSeq` 的兜底和「回到最新」都跳过这种轮次；全部都是时保持原来的取最新行为。空轮仍然列出、可以选。
- 锚定在人发消息上的房间轮带 `startSeq = dispatch.seq − HUMAN_MESSAGE_LOOKBACK`（按构造，那条消息就在这个回看范围内）。`syncScrollToTurn` 落到房间轮的消息行前，先像宿主轮一样经 `loadThrough` 翻页（`hasMessageAnchor`）。

## Alternatives considered

**去掉无 childTurn 运行的时间窗兜底。** 旧日志和部分生产方从不记录 `childTurn`，那些轮次会变空。

**把空轮从列表里藏掉。** 它们是真实的宿主轮，报错值得看；只挪默认落点。

**在派发上记下人发消息的精确 seq。** 更准，但要在实时和回填两条路径里多传一个值；多翻十来个事件无害。

## Consequences

结束记录丢失的运行现在只显示自己的请求，这种情况下趋势里每个请求只算一次。最新一轮是被拒跟进的会话，打开时落到最新的有内容轮次。已渲染历史之外的房间轮能跳到了。如果没有结束记录的运行恰好是该成员的最后一次运行，它的窗口仍然到现在——没有后续运行可以截断。
