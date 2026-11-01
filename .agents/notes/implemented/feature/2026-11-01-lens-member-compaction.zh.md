# Agent Note：Context Lens 把 CLI 成员的压缩显示在所属的那一轮

Status: implemented

## 问题

外部 CLI 成员的压缩在 Context Lens 里没有任何痕迹：压缩不开新的一轮，Context Lens 就不为它生成请求。更糟的是，房间里人发的 `/compact` 被单独列成一轮，还借来了上一轮的请求，因为那次运行记下的是子会话最后一轮的编号。用户希望把压缩挂在上一轮下面、单独一个页签，和宿主自己的压缩一样。

## 决定

- **日志通道**：按结构读取 local-agent 在宿主登记过的 `local-agent/compaction` 事件，生成一条压缩请求（`purpose: 'compaction'`，`inputPartial`）。
  - 压缩调用的用量就是这条请求的用量，CLI 的摘要作为它的输出。
  - `CompactionInfo` 新增 `source`、`beforeTokens`、`afterTokens`、`betweenTurns`。
  - 发生在一轮里的压缩（CLI 自己触发的）归那一轮；发生在两轮之间的压缩（`/compact`）归最后结束的那一轮。为此 cursor 记下 `lastTurnHost`。
  - 它的输入是成员当时折叠出的上下文。Kimi 自己的记录（`llm.request kind:compaction`）显示，这次调用发送了全部历史（`droppedCount: 0`），系统提示和工具的哈希也与平时相同；只有 CLI 的压缩指令没有记录。
  - 它不占请求编号：`logIndex` 取前后两个请求之间的位置（`n - 0.5`），所以成员日志不带正文时，也能像其他请求一样在读取时重建它的正文。
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

- **压缩之后的上下文**：
  - Kimi 的 `context.apply_compaction` 记录了压缩后上下文变成了什么（`contextSummary`、`keptUserMessageCount`）。local-agent 现在把这两项抄进自己的事件，字段为 `contextSummary`、`keptUserMessages`。
  - 日志通道据此改写折叠出的上下文：保留用户消息（给了数量就保留最新的 N 条），其余用一条承载这段文字的 `compact-checkpoint` 消息替换。旧事件只带摘要，Codex 两者都没有，所以依次退回到摘要、再退回到一个占位标记。
  - 成员日志只追加、不改写，所以这次替换是推断出来的，日志里没有对应记录。日志通道通过新增的 `FoldSink.replacement` 把它作为 `ReplacementFact` 报出来（`kind: 'compaction'`，`compactionId` 即压缩请求的 id）；service 在子会话和主会话两条回填路径上都把它登记进 store 的替换记录。
  - 这样下一个请求的缓存断点就会显示为这次压缩，并能跳到那次压缩请求。在 75844e33（成员 443e7c65）上，#167 有 65 条消息（保留的 63 条、摘要、新的提示），与 Kimi 自己记录的数目一致。

## 影响

- `/compact` 之后的轮次编号整体减一，因为轮次是读取时现场编号的。
- Kimi 原样保留的用户消息里包含它自己注入的提醒，我们的镜像里只有人发的提示；不过双方都不含这些注入的提醒，所以按人发的提示计数时两边一致。
