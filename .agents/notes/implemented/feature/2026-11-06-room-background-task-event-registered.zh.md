# Agent Note: `room/background-task` 先登记、后写入

Status: implemented

## Problem

成员自己开轮的设计（`proposals/active/2026-11-06-member-self-started-rounds.md`，不在仓库里）需要记一件不属于任何执行的事实：CLI 成员的后台任务失去联系，比如 Kimi 的 `bash-…` 任务还在跑时宿主重启了（C②）。那一刻没有轮次在跑，`room/run-state` 和 `room/speech` 都放不下；`local-agent/execution` 是执行记录，也不该承载。设计为此新增一个房间事件类型。

宿主的存储日志读取器遇到目录（`KNOWN_SESSION_EVENT_TYPES`）里没有的事件类型，会拒绝整份日志。如果登记和第一次写入放在同一个版本里，回退这个版本后，旧版本就打不开已经写过它的房间。所以和批 5 S0（`2026-11-04-local-agent-execution-event-registered`）一样，这个类型要比任何写入它的版本早一个版本登记。

## Decision

M0 只登记 `room/background-task`，不写入。第一个写入方是 M6。

- **登记位置**：`packages/room/src/journal.ts` 的 `ROOM_EVENT_TYPES`。`packages/room/src/index.ts` 里已有的两处循环（模块加载时，以及 apply 时经 loader 解析到的目录）会登记这个列表的每一项，其他代码不用改。
- **形状**：`SessionEventMap['room/background-task']` 为 `RoomBackgroundTaskEvent`（`packages/room/src/types.ts`），与设计 C② 的形状一致：`member`、`memberId`、`taskId`（CLI 自己的任务 id）、`label`、`state: 'lost'`、`because`（`RoomBackgroundTaskLostBecause`：`host-restart | process-reclaimed | process-exited`，即 B① 的 `lostBecause` 取值）、可选 `startedByRunId`。两个类型都从包根导出。
- **回放**：M0 的 `replay` 不从这个事件折叠任何东西，有它没它，房间状态都一样。时间线那一行和按 `taskId` 去重由 M6 加。
- **一旦有任何版本写过这个事件，就不得去掉这条登记**，也不得改类型名。后续步骤只能加可选字段，或加新的 `state` / `because` 取值。

## Alternatives considered

- **登记和写入放在同一步（M6）**：否决。回退后房间打不开。
- **挂在 `room/run-state` 或 `room/speech` 上**：设计已否决。重启之后没有可挂的 run。

## Consequences

- M6 及以后版本写下的房间，在本版本及以后的任何版本上都能打开，包括回退 M6+ 之后。
- 这个类型成为永久词汇。以后删掉它，所有带它的房间都会打不开。

## Testing

`packages/room/tests/background-task-event.host.spec.ts`：
- 模块加载后，类型在 `ROOM_EVENT_TYPES` 里，也在宿主目录里；
- 带这条事实的房间日志（有和没有 `startedByRunId` 各一条）经真实 jsonl 持久化读取器往返，`replay` 的结果与不带它的日志相同；
- 去掉登记后，同一份日志被拒绝（`SessionFormatUnsupportedError`），而不带它的日志照常读出。这是对照组；
- `packages/room/src` 下除 `journal.ts` 和 `types.ts` 外没有文件提到这个类型，即还没有人写它。M6 要同时改这条断言。

`packages/room/tests/persistence.host.spec.ts` 的往返测试也追加了这个事件，因为那条测试要求 `ROOM_EVENT_TYPES` 的每一项重载后都在。
