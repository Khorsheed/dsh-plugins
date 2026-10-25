# Agent Note: Context Lens room rounds

Status: implemented

## Problem

房间会话里，一旦其他成员接手协调，主会话就不再跑 turn：人发给房间的消息变成 `room/dispatch`，工作在各成员自己的子会话里运行。Context Lens 按主会话 turn 分组，所以协调者交接之后面板就看不到新内容了。成员的运行不可见，在 turn 之外登记的子会话也被回填丢掉了。

## Decision

- **主会话 turn 之外的每次人工派发算一轮。** store 按主会话记下 room 插件的事件（`noteRoomEvent`，在 `src/room.ts` 里按结构读取，日志回填与实时通道同一套）。每条 `origin: 'human'` 的 `room/dispatch`，只要时间不落在任何主会话 turn 的区间里，就单独列为一轮：query 是消息本身，`room.targets` 是它发给的成员，turn 地址为 `-1_000_000 - dispatchSeq`。轮次在读取时构建，不额外存储。
- **一轮只装它发起的运行。** 运行来自 `room/run-state`（`runId` 为 `<dispatchSeq>:<memberId>`）。每个运行的视图是它子会话的 scope，沿用子会话自己的 scope id，只装这一次运行的请求：优先按运行记录的子会话 turn（`childTurn`），否则取运行时间段内（±2 秒）开始的请求。子会话按 `childSessionId` 找，否则取登记时间离运行开始最近的子 agent（10 秒内）。还没有子会话的运行显示为空视图。
- **保留 turn 之外的子会话。** `reconstructSession` 把放不进任何 turn 的委派收进一个隐藏容器（`purpose: 'room-members'`）；store 把它们的 scope 放进一个从不列出的隐藏 turn，子会话请求照常落进来，轮次再从中切分。实时通道里 turn 之外的 catalog 事件进同一个容器。
- **整个会话一套编号。** 主会话 turn（无论是否载入，按日志区间）与房间轮次按时间统一编号（`TurnListItem.ordinal`、`ListTurnsResult.total`）。未载入的区段由 store 按这套编号给出（`ListTurnsResult.unloaded`，两端附带宿主 turn 号供窗口移动使用）。会话地图、query 行、轮次菜单、`N / 总数` 切换器和 ‹ / › 步进都用这套编号；载入窗口仍按宿主 turn 寻址。
- **会话地图。** 一轮里成员的请求放在主会话 turn 原本的位置。协调者交接（`room/coordinator`）在其后第一个 turn 之前画一条虚线，标注「<名字> 接手」。同一个间隙里有多次交接时只画一条线，标注到那一轮为止实际接手的成员，加上之前几次的计数（「剪刀手五号 接手 +1」）；悬停提示列出完整的交接链。原来每次交接各画一条、相隔 10px，标注会叠在一起看不清。
- **外部 agent 自己的会话只看日志。** CLI 成员（claude-local、codex-local、kimi-cli、dsh-cli——除宿主进程内的 `spawn`/`fork` 以外的所有子 agent 提供方）在自己的进程里运行，它的请求都不经过本宿主；单独打开它的会话时，能看到的只有日志里的内容。日志里（或实时收到）的 `subagent/descriptor` 一旦表明是这类提供方，store 就把该会话标为只看日志（`markLogDriven`）：实时事件不再开启轮次，只标记需要重读日志（`noteLogActivity` → `needsLogRead`）；每次读取时，日志里增长或已结束的已载入轮次按日志重建，新轮次补进来，回填完成后也照样如此。日志里未结束的最后一轮显示为进行中，而不是中断。面板仍是拉取式：每次读取（打开、切换或步进轮次）显示日志当时写到的内容。
- **缓存命中未知。** usage 里没有 `cacheReadTokens` 的请求，命中率显示「—」、地图柱子显示灰色，而不是红色的 0%。部分来源（codex、claude-code）暂未上报缓存读取。

## Alternatives considered

**只把成员运行放在建立房间的那个主会话 turn 里。** 这些运行发生在几小时之后，会全部堆进同一个 turn。

**房间轮次单独编号（R1、R2…）。** 一张地图上两套序号读起来像两段对话；用户选择了按时间的一套编号。

## Consequences

- 2026-10-25：页签可以查看另一个会话。导航参数 `{ sessionId, messageId }` 把面板指向那个会话（比如房间成员的子会话），并选中这条消息收尾的那一轮（`resolveTurnSeq`）；下一次不带会话参数的导航会回到侧栏所属的会话。查看别的会话时不联动滚动对话。（曾经加过「正在看」提示条和返回按钮，负责人认为用不上，已去掉。）
- 房间会话里，面板的轮次编号不再等于宿主的 turn 号；其他会话仍然一致。
- 没有 `childTurn` 时，同一成员时间重叠的两次运行会共享请求。room 插件正在 `done` 时补上 `childTurn`。
- 轮次不受窗口限制；派发了几百次的房间会全部列出。

## Testing

`tests/room-rounds.spec.ts` 覆盖：隐藏容器、轮次与主会话 turn 统一编号、交接、按时间段与按子会话 turn 切分运行、trend 行，以及跳过主会话 turn 内的派发。
