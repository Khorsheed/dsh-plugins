# Agent Note: 收进了后台任务结果的成员回复会标出来

Status: implemented

## Problem

Kimi 成员的后台任务可能在成员忙另一轮时结束。这种情况下 Kimi 不会为它单独开一轮，而是把任务通知以用户角色的 `context.append_message` 追加进正在跑的这一轮，`message.origin` 为 `{ kind: 'task', taskId, status, notificationId }`。这一轮的回复交给这一轮的派活人。

设计（`member-self-started-rounds` A④ 最后一条「轮内收到的结果」，待定 5 = A）规定：房间不把结果转给任务原来的派活人，只在那条回复上加一行安静的小字「含后台任务结果 · <任务>」，和 M5 的「↻ 后台任务完成后继续」同一族样式。房间从不读 Kimi 的 wire，所以这个事实必须由 Kimi 经核心传过来。

## Decision

事实走现有的结算报告和执行 end 记录。新字段全部可选，不新增事件类型。

- **Kimi**（`self-turn.ts`）。
  - `foldedTaskResults(wire, promptLine)` 列出一轮之内来源为任务的用户追加，范围到这一轮的 `turn.ended` 为止（这一轮被打断时到下一个 prompt 为止）。这一轮自己的通知不算：自开轮会把自己的 prompt 以同一通知 id 再追加一次，那是这一轮的起因，不是它收到的结果。条目按通知 id 去重。描述取 wire 上任意位置该任务 `task.started` 的 `info.description`。
  - `firstUserPromptLine(wire, fromLine)` 用来找常驻轮自己的 prompt。
  - 常驻驱动在一轮结算时读一次 wire（常驻轮和自开轮都读），把 `taskResults` 放进 `recordRoundSettled`。空闲计时器在读 wire 之前就重新挂上，保活时序不变。
- **核心**。
  - `recordRoundSettled` 接收 `taskResults`，交给当前执行的观测。
  - end 记录（`local-agent/execution`，phase `end`）带 `taskResults?: LocalAgentFoldedTaskResult[]`（`taskId`、`taskStatus`、`label?`、`notificationId?`），只在列表非空时写入。
  - `LocalAgentExecutionReading` 和 `LocalAgentExecutionSettlement` 原样带出这个字段。
- **房间**。
  - 不写任何日志。`getState` 本来就会给每个带执行 id 的 run 附上核心的读数。
  - `RoomSpeechView` 把 `execution.reading.taskResults` 显示成 `.cause` 样式的一行：「含后台任务结果 · 部署 …、跑测试」。描述用语言包里的分隔符连接；没有描述的任务不列出，一个描述都没有时只显示「含后台任务结果」。
  - 这一行不是链接（没有记录可跳转的那一轮）。
  - 房间自己派的活和别处发起的轮次都有效，因为两者读的是同一份读数。

## Alternatives considered

**在 `room/speech` 或终态 `room/run-state` 上加可选字段**。房间在执行结算之前就写下回复：`followCliRound` 从不等结算报告。要把事实放在那里，就得压住回复不发，或者结算后再写一次。读数在每次读取时本来就按 run 关联好了，房间不需要另存一份。

**在成员日志的镜像步上做标记**。轮内追加在镜像转写里是有意丢掉的（`promptsMarkTurns`），镜像事件又是宿主类型。把插件字段挂在上面，会把属于这一轮的一个事实拆散到各步里。

**同时把结果转给原派活人（待定 5 = B）**。用户已否决。回复已经交给了这一轮的派活人，而且我们分不出回复里哪一段来自后台结果。

## Consequences

- 旧日志不显示：它们的 end 记录没有这个字段，核心也不会事后推断。
- 只有 Kimi 报这个字段，其他 provider 不带。
- 结算时读不到 wire，字段就缺省，回复上也不出现这一行。
- 为另一个任务开的自开轮里收到的结果也会标出来，因为那一轮结算时跑的是同一个读取函数。

## Testing

- `local-agent-kimi/tests/self-turn.spec.ts`：轮内收集与描述、轮次边界、自开轮自己的回显、其他注入与重复。
- `local-agent-kimi/tests/live-driver.spec.ts`：wire 里有轮内任务追加的常驻轮，其结算报告带 `taskResults`。
- `local-agent/tests/execution-records.spec.ts`：报告落到 end 记录和 `readExecution`；没有结果的轮不写字段。
- `room/tests/usage-reading.client.spec.tsx`：中英文这一行、描述连接、没有结果时不显示。
- 预览页 `room/tests/preview/self-round.html?state=folded`，在 1280 和 390 宽度下截图。
