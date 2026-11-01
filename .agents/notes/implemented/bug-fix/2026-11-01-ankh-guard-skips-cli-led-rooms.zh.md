# Agent Note：ankh-guard 不唤醒由外部成员主持的房间

Status: implemented

## 问题

意外恢复后，ankh-guard 会把重启报告作为跟进轮排给第一个创建的根 agent，还会给每个被重启打断的会话排一轮「继续」。2026-11-01 崩溃后第一个被打开的会话是一个协作间，它的协调者是 kimi 命令行成员。房间插件会拒绝所有不是它自己派发的宿主轮（`Use the room input route for this coordinator; this input cannot be forwarded losslessly`），所以这份报告变成了一个失败的宿主轮：0 次请求，也没有用户消息。Context Lens 打开时因此落在这个空的失败轮上，因为它是会话的最新一轮。报告本身也丢了，因为记录已经被确认过。

## 决定

- **当前协调者是 `cli` 成员的房间，既不收报告，也不收「继续」。** `isExternalCoordinatorRoom(events)`（src/restart-context.ts）读房间自己落盘的事件：`room/created`、按 `id ?? legacy:<seq>` 索引的 `room/member-added` 成员类型，以及最后一条 `room/coordinator`。从没换过协调者的房间由主 agent 主持，不跳过。
- **`deliver` 同步探测活会话**，读的是 `agent.session.snapshotEvents()`，和房间插件判断时用的是同一个接口。宿主没有这个接口或探测出错时，照旧投递（失败放行）。
- **被跳过的报告保持待领取**，由下一个普通根会话领走。
- **恢复流程不重建这类房间。** 冷日志上用同一个判断，和「停在等用户输入」的检查放在一起。房间被打断的成员运行，由房间自己的「继续」设计接上。

## 考虑过的方案

- **改走房间输入路由投递报告。** 不采用：这等于以人的名义对外部协调者说话，还会让 ankh-guard 依赖房间插件。
- **所有房间会话都跳过。** 不采用：仍由主 agent 主持的房间正常接收宿主轮，应该照常收到报告和「继续」。

## 后果

- 如果重启的发起者本身就是这类房间，它的报告要等下一次重启替换记录。这种情况更少见，也无害，因此接受。
- self-process 泳道的用例清单加 3（71 → 74）。
