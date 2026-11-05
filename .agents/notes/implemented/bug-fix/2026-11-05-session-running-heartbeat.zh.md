# Agent Note：房间和 CLI 成员会话在浏览器刷新后保持运行中转圈

Status: implemented

[English](2026-11-05-session-running-heartbeat.md) | 中文

## 问题

[10-27 会话列表状态笔记](../feature/2026-10-27-session-list-status-for-delegations.md)让房间会话和 local-agent 子会话在每次 0→1、1→0 翻转时发宿主的 `api-session/status` 事件，从而显示「运行中」。它记下的已知限制是：浏览器刷新或重连后，要等下一次翻转状态才回来。宿主列表摘要的 `running` 只看宿主自己的 agent（`deepseek-harness packages/api/session-controller/src/list.ts`），状态事件只发不存、不会重放（`packages/api/remotes/src/remote-events.ts`），客户端在刷新、重连和 `api-session/added` 时都按摘要重设每一行（`packages/client/ui-session/src/client/index.ts`）。所以房间成员连续干十分钟活，页面一刷新，这十分钟里都显示空闲。之后再来一个 `true` 事件会覆盖基线（`observeRunning`），这个临时做法靠的就是这一点。

## 决策

STOPGAP(session-activity-contribution)：上游的宿主活动租约落地后替换。代码里每一处都带这个标记。

- **local-agent 门面运行（`trackRun`）**：已有的逐运行进度心跳（`RUN_PROGRESS_HEARTBEAT_MS`，5 秒）在条目仍属于这次运行时，顺带重发 `running: true`。
- **local-agent 工具登记的运行（`trackDelegationRun`）**：每个条目新增一个 unref 的定时器（`SESSION_STATUS_HEARTBEAT_MS`，4 秒）重发 `running: true`。运行结果落定时先清掉它，再照旧发最后的 `false`；插件 dispose 时也会清掉。
- **room**：一个全局 unref 定时器（`ROOM_STATUS_HEARTBEAT_MS`，4 秒）遍历 `activeRuns`，为每个有成员在跑的房间重发 `running: true`。`activeRuns` 出现第一个房间时，`observeActivity` 启动它；最后一个房间清空时停掉它。dispose effect 也会停掉它。
- **过期运行守卫（core 账本）**：batch 5 S7 起，成员的执行账本说了算，决定一次执行是否还在进行，所以泄漏的运行不会一直转圈。room 每一拍会检查带 `executionId` 和 `childSessionId` 的活跃运行，到成员账本（`readMemberInbox`）里查对应的行。行已落定、待对账或不存在，就丢掉这次运行，并打一条宿主警告（"dropped a stale active run"）。如果房间因此空了，就和正常最后一个结束时一样落定：发一次 `false`，除非房间自己的 agent 还在跑。没有 `executionId` 的运行（房间自己的 agent、S5 之前的运行）、没有账本读取接口的 core、读不出来的账本，都照旧只做重发。local-agent 里工具登记的条目不带执行 id，所以采用保守规则：只有成员账本可读且非空、没有排队或运行中的行、最新一行在条目登记之后才落定或转为待对账时，才撤掉条目（清定时器、发一次 `false`、打警告）。
- 0→1 / 1→0 翻转逻辑、最后的 `false`、主 agent 停下后的补发都不变。重发包在 try/catch 里，宿主没有这个通道时退回原来的行为。没有运行时什么都不发。
- 4 秒对齐客户端已有的 pendingCards 轮询。门面路径沿用自己的 5 秒心跳，不另加定时器。

## 备选方案

- **宿主活动租约**（上游提案 `docs/upstream-proposals/2026-10-27-session-activity-contribution.md`）：这是正解，摘要本身就会带上插件贡献的活动。它需要改宿主，落地之前先用这个临时做法。
- **客户端刷新后重新查询**：客户端没有插件能读的实时状态来源，而且得改官方客户端代码。
- **room 每个运行一个定时器**：否决，改为每个进程一个定时器，因为一个房间可能同时有很多成员在跑。

## 后果

- 刷新或重连后，正在运行的房间或 CLI 子会话在一拍之内恢复转圈（最多 4 秒，门面运行最多 5 秒）。
- 每个活跃运行或活跃房间每隔几秒向所有已连接客户端发一个小事件。空闲进程什么都不发。
- 如果某次运行的终态 `room/run-state` 一直没落盘，core 落定之后，账本守卫会在一拍内撤掉它。没有 `executionId` 的旧运行没有这层检查，会一直重申 `running`，直到终态边到来。如果 core 落定一行比房间写下终态边早几毫秒，一拍正好落在中间，会提前丢掉这次运行并打一条无害的警告；之后到来的终态边不会让房间再落定一次。
- 测试：`packages/local-agent/tests/delegation-facade.spec.ts`（status heartbeat：工具登记心跳加最后的 false、门面心跳、账本撤掉泄漏、运行中与绕过账本的运行保留、空闲不发、dispose）和 `packages/room/tests/session-status.host.spec.ts`（status heartbeat：心跳加最后的 false 加定时器清除、账本丢掉泄漏只落定一次、运行中与旧运行保留、空闲不发、dispose）。
