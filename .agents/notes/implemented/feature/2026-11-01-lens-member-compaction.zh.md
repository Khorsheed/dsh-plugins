# Agent Note：Context Lens 把 CLI 成员的压缩显示在所属的那一轮

Status: implemented

## 问题

外部 CLI 成员的压缩在 Context Lens 里没有任何痕迹：压缩不开新的一轮，Context Lens 就不为它生成请求。更糟的是，房间里人发的 `/compact` 被单独列成一轮，还借来了上一轮的请求，因为那次运行记下的是子会话最后一轮的编号。用户希望把压缩挂在上一轮下面、单独一个页签，和宿主自己的压缩一样。

## 决定

- **日志通道**：按结构读取 local-agent 在宿主登记过的 `local-agent/compaction` 事件，生成一条压缩请求（`purpose: 'compaction'`，`inputPartial`）。
  - 压缩调用的用量就是这条请求的用量，CLI 的摘要作为它的输出。
  - `CompactionInfo` 新增 `source`、`beforeTokens`、`afterTokens`、`betweenTurns`。
  - 发生在一轮里的压缩（CLI 自己触发的）归那一轮；发生在两轮之间的压缩（`/compact`）归最后结束的那一轮。为此 cursor 记下 `lastTurnHost`。
  - 这条请求用独立的 cursor 生成，并去掉 `logIndex`，这样重建请求正文时不会把它当成日志里的第一个请求。
- **房间轮次**：
  - 人发的 `/compact` 派发不再单独成轮。
  - 在每一轮里，成员 scope 的压缩请求移到 `compaction:<子会话>` scope（`kind: 'compaction'`），也就是排在该成员之后的「压缩」页签。它的概览带 `compaction.member {name, source, beforeTokens, afterTokens}`。
  - 单独打开成员会话时不需要新做什么：主会话回填本来就会把压缩请求变成伪轮次，再按 `hostTurn` 挂到对应的轮。
- **面板**：
  - 「压缩」页签的关系行写「X 在本轮之后压缩（/compact）」或「X 的 CLI 在本轮中自动压缩」，后面跟「上下文 289K → 44.7K tok」。
  - 请求头显示压缩前后的占用，并用外部 CLI 的说明代替宿主那段重建说明。

## 考虑过的方案

- **`/compact` 仍单独成一轮，里面只放压缩**：不采用。它不是一轮对话，宿主自己的压缩也不算一轮。
- **把压缩混在成员的请求列表里**：不采用。那样看起来像这一轮里的一次模型调用；单独一个页签与宿主的「压缩」页签一致。

## 影响

- `/compact` 之后的轮次编号整体减一，因为轮次是读取时现场编号的。
- 下一个请求的输入仍显示整段历史，缓存断点也还没有原因说明。按压缩边界重建请求是第二步。
