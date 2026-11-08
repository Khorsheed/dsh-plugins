# Agent Note：宿主重启丢掉的后台任务如实标为失去联系，并告诉派活人

Status: implemented

## Problem

宿主重启会杀掉所有 Kimi 成员的常驻进程，进程里正在跑的后台任务随之失去进程，结果再也不会有人汇报。Kimi 自己的 `tasks/<id>.json` 会一直写着 `running`，直到之后某个进程重新载入这个会话。此前房间对此毫无提示：成员说过的「完成后我会继续汇报」悄悄落空，派活人一直在等。这对应设计 `proposals/active/2026-11-06-member-self-started-rounds.md`（不在仓库里）的 C② 节。M0 已为这件事登记了 `room/background-task`（见[登记说明](2026-11-06-room-background-task-event-registered.zh.md)），M6 是它的第一个写入方。

## Decision

- **Kimi 只说它确知的事**（`withKnownLoss`，`packages/local-agent-kimi/src/background-tasks.ts`）：任务的开始时间早于本宿主进程中 Kimi 插件的启动时间，就读作 `lost`，`lostBecause: 'host-restart'`。文件仍写着 `running` 的、被后来的载入改写成 `lost` 的，都按此处理。本代驱动收回过进程的任务，仍按 M3 记为 `process-reclaimed`。其余一概不判断：不探测 pid；文件写着 `running`、没有进程、我们也没有记录的，原样保留。托盘的每次读取和启动扫描都走这同一条规则。
- **核心的启动扫描**（`LocalAgentRegistry.lostBackgroundTaskParents(since)`）：遍历 harness 声明了 `backgroundTasks` 的委派记录，读每个成员的任务状态（`memberBackgroundTasks(child, { lookups: false })`，跳过对成员日志的查找），返回有 `host-restart` 丢失、且任务开始于 `since` 之后的父会话。整个过程只读文件，不启动 CLI 进程，不调用模型。
- **房间挂在 M10 的启动路径上**：`loadInterruptedRooms` 在加载被打断的房间之外，也加载核心点名的这些房间，并调用 `recordLostBackgroundTasks(room, { force: true })`。此外，每个房间在本宿主进程里第一次被访问时也会扫一次（`ensureLive` 里的 `scanLostOnce`），覆盖启动扫描之前就被打开的房间。对每个 CLI 成员，满足以下条件的任务各写一条 `room/background-task { member, memberId, taskId, label, state: 'lost', because, startedByRunId? }`（`because` 取任务的 `lostBecause`）：状态为 `lost` 且原因是 `host-restart`（或 `process-reclaimed`，见 Consequences 一节链接的收回说明），开始时间在本进程启动前 `LOST_TASK_LOOKBACK_MS`（24 小时）以内，房间日志里还没有记录（按 `memberId` + `taskId` 去重）。先完成全部读取，之后的去重检查和写入同步执行，所以并发的多次扫描不会把同一个任务写两遍。
- **时间线**：room-event 节点把这条事实认领为 `sub: 'background-lost'`，渲染成虚线之间的一行警示色文字：「⚠ X 的后台任务「…」在宿主重启后失去联系 · 结果不会自动回来」。
- **后续回报**：如果 `startedByRunId` 对应的投递本来会汇报（沿用 M5 的 `followUpDelivery` + `followUpRecipient` 规则），就经汇报闸门发一条后续回报：`reportFor = background-task:<memberId>:<taskId>`，`followUpOf` 为那条投递，结局为 `uncertain`，正文是固定说明「后台任务「…」在宿主重启后失去联系，它可能已经结束，也可能还在跑；没有结果。需要的话请让 X 核对后重做。」。信封写「#mN 的后续回报 · 来自 X · 失去联系」，不带「用户已看到」的后缀，因为并没有哪条回复是用户看过的。收件人的回复上方以警示色显示「⚠ 收到 X 的后续回报 · 失去联系」。人派的活只有时间线那一行。

## Alternatives considered

- **探测任务的 pid**：否决。pid 会被复用；设计也只说「失去联系」。
- **Kimi 列出的丢失任务全部写入**：否决。几周前的任务文件可能还写着 `running`，本功能上线后的第一次启动就会拿陈旧消息唤醒派活人。24 小时的回看窗口是房间的策略；`host-restart` 这个原因本身仍是 Kimi 记下的事实。
- **新增 local-agent 事件，或在房间投影里加字段**：否决。这个事件类型本来就是为此登记的；`replay` 仍不从它折叠任何状态。

## Consequences

- 不只是宿主重启，插件重新载入后，之前开始的任务也会读作 `host-restart`。两种情况下进程都已经没了。
- 因 `process-reclaimed` 丢失的任务（M3 的 4 小时上限、重新载入、切换模型）在收回进程的那一刻经同一条路写进房间并发后续回报，见[进程被收回时的后台任务也写进房间](2026-11-08-room-background-task-lost-at-reclaim.zh.md)。
- 开始时间早于重启前 24 小时的任务不会报告。

## Testing

- `packages/local-agent-kimi/tests/background-tasks.spec.ts`：`withKnownLoss`。覆盖：`running` 和 `lost` 两种文件无论进程在不在都读作 host-restart；收回过与没收回过；本进程里在跑的任务保持原样；已结束的任务不动。
- `packages/local-agent/tests/execution-read.spec.ts`：`lostBackgroundTaskParents` 只返回在截止时间之后有 `host-restart` 丢失的父会话；一个父会话已有成员命中后不再读它的其他成员；不查成员日志。
- `packages/room/tests/dispatch.host.spec.ts`：成员派的活 → 写一条事实，并给 ada 发一条带固定说明的「失去联系」后续回报；被收回的、太旧的、仍在跑的任务都被忽略；第二次扫描什么也不写。人派的活 → 只写事实。启动加载以 `since = bootedAt − 24 小时` 查询并完成记录。
- `packages/room/tests/nodes.client.spec.tsx`：节点与那一行警示文字。`packages/room/tests/background-task-event.host.spec.ts`：只有 `background-lost.ts` 写这个类型，只有 `client/nodes.ts` 读它。
- 预览：`packages/room/tests/preview/self-round.html?state=lost`。
