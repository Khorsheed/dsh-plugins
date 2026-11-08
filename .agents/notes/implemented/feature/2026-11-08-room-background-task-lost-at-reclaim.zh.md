# Agent Note: 进程被收回时丢失的后台任务也写进房间

Status: implemented

## Problem

Kimi 成员有后台任务在跑时，常驻进程会一直保留，最长 4 小时（M3，[有后台任务时保留常驻进程](2026-11-06-kimi-keepalive-background-tasks.zh.md)）。到上限时照样收回。重新载入、切换模型、实时开关的交接排空，也会在任务可能还在跑时换掉进程。这些情况下任务都失去联系（`lostBecause: 'process-reclaimed'`）。[宿主重启时丢失的后台任务](2026-11-07-room-background-task-lost-at-restart.zh.md)（M6）已经把宿主重启造成的丢失写进房间：时间线一行，再给派活人发一条「失去联系」后续回报。进程被收回造成的丢失却只在托盘里显示，成员承诺的汇报就这样悄悄落空。这正是设计稿 C①、C② 要堵的情况（`proposals/active/2026-11-06-member-self-started-rounds.md`，不在仓库里）。

## Decision

- **Kimi 在收回进程的那一刻报告**（`packages/local-agent-kimi/src/live-switch.ts`）。驱动已有的 `onReclaimedWithTasks` 钩子（M3）落到 `LiveDriverSwitch.noteReclaimed`。切换器先记下这些任务，从此每次读取都会说 `process-reclaimed`；然后调用核心的 `noteBackgroundTasksLost(child, taskIds, 'process-reclaimed')`。调用是鸭子类型的：没有这个钩子的旧核心直接跳过，抛错只记日志。插件卸载（`disposeAll`）仍以 `noteTasks: false` 收回，所以什么都不报；下次宿主启动的扫描会把这些任务读作 `host-restart`。
- **核心带上父会话再发出**（`LocalAgentRegistry.noteBackgroundTasksLost`）。它从委派记录或成员绑定里找到成员的父会话，然后发出宿主总线事件 `localAgent/background-tasks-lost { childSessionId, parentSessionId, taskIds, because }`（声明在核心的 cordis `Events` 里，类型 `LocalAgentBackgroundTasksLost`）。成员未知或任务列表为空时不发。
- **房间当场记下**（`RoomService.recordReclaimedBackgroundTasks`，监听这个事件）。只有父会话是房间时才动作（`loadCold`）。它经 `ensureLive` 把房间带活，这和打开房间、和 M10/M6 的启动加载是同一种访问，所以冷房间也会被加载。然后调用 `recordLostBackgroundTasks(room, { reported })`，也就是 M6 的那条路：
  - 只读这一个成员。报告里的任务一律按 `process-reclaimed` 丢失处理，不管文件此刻写什么：重新载入之后，新进程可能已经起来，而 Kimi 的文件仍写着 `running`。
  - 每个任务写一条 `room/background-task { …, because: 'process-reclaimed' }`，按 `memberId` + `taskId` 在房间日志上去重。时间线这一行本来就有对应文案：「X 的后台任务「…」在进程被收回后失去联系 · 结果不会自动回来」。
  - 启动它的那次投递会汇报时（M5/M6 的规则），经闸门发后续回报，键同样是 `background-task:<memberId>:<taskId>`，正文用收回的说法：「后台任务「…」在进程被收回后失去联系，它可能已经结束，也可能还在跑；没有结果。需要的话请让 X 核对后重做。」（`lostReportText(member, label, because)`）。人派的活只有时间线那一行。
  - 收回触发的这一遍扫描，不顶替房间每进程一次的重启扫描。
- **首次访问兜底。** `lostToRecord` 现在在 `host-restart` 之外也接受 `process-reclaimed`。所以房间在一个进程里第一次被访问时，也会补记事件漏掉的收回丢失（例如房间插件当时正在重新载入）。24 小时回看窗口和去重都不变，同一个任务绝不会写两遍，下次宿主启动把它读成 `host-restart` 时也一样。

## Alternatives considered

- **轮询托盘读取，找新丢失的任务。** 否决：任务说明和设计稿都要求由收回本身触发；没有进程在跑时，没有东西看着文件。
- **让 Kimi 插件直接调房间。** 否决。provider 不知道房间的存在。成员到父会话的对应本来就归核心，房间本来也探测核心，这样保持「伴随包 → 核心」的单向依赖。
- **新的房间事件类型。** 否决：`room/background-task` 就是为这件事登记的，本来就带 `because`。
- **读取时信任任务文件的状态。** 否决。重新载入之后，新进程已经起来，文件可能仍写着 `running`，`withKnownLoss` 也会把它读成在跑，房间就会漏掉这次丢失。报告里的任务 id 才是事实。

## Consequences

- 有任务在跑时，到 4 小时上限收回、重新载入、切换模型、实时开关排空，房间里现在都会出现琥珀色的一行；成员派的活，派活人会收到「失去联系」。宿主重启的说法不同（「在宿主重启后失去联系」）。
- 为了发后续回报，冷房间会被加载、房间的 agent 会被恢复，代价与 M6 的启动加载相同。
- 出错路径上的收回（运行时已死、启动失败、一轮被中止）如果还有在跑的任务，也会报告：进程同样没了。
- 没有在真实 Kimi 进程上验证。触发路径由切换器、核心和房间的单元测试覆盖。

## Testing

- `packages/local-agent-kimi/tests/live-switch.spec.ts`：切换器先记下任务再告诉核心（报告过程中的读取已经是「已收回」）；没有钩子的旧核心或会抛错的核心，托盘事实照样保留。
- `packages/local-agent/tests/delegation-facade.spec.ts`：`noteBackgroundTasksLost` 带父会话发出；成员未知或列表为空时不发。
- `packages/room/tests/dispatch.host.spec.ts`：
  - 成员派的活被收回、文件仍写着 `running`：写一条事实（`process-reclaimed`）和一条用收回说法的后续回报，只读了这一个成员。
  - 同样的报告再来一次、之后对同一任务的宿主重启扫描，都不再写任何东西。
  - 人派的活只写事实；父会话不是房间时根本不读。
  - M6 的重启用例不再把收回的任务列为「不是本次重启的消息」。
