# Agent Note：CLI 成员的排队与重启恢复归 local-agent 核心

Status: implemented

## 问题

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，在仓库外）第 S7 步。S5 之后，CLI 成员的每一轮都经核心的 `run()` 和每成员账本，但 room 在它上面还留着一层。它有自己的每成员 `queues`/`scheduled`。它也有自己的重启判定：`recover()` 把所有 running 的投递改成 `uncertain` 并写一条 failed 的运行边，`view()` 把内存里没有的 running 运行一律投影成 failed。于是有两套互不知道的「结果不确定」。重启打断的房间轮次在两边都是不确定；在房间里对账后，核心那一行仍是不确定，成员随后拒绝房间的每一轮，连本该「按没做完处理」的那条新消息也被拒。成员页一条不确定的输入会让房间派活以 `MEMBER_UNRECONCILED_TEXT` 失败。别的调用方开的一轮（`execution:<id>`）重启后在房间里显示失败，核心却说不确定（S5 的缺口）。S4 还记下 `reconcileExecution` 让成员日志里该执行的 start 一直没有 end。

## 决定

- **CLI 成员没有房间队列。** `DispatchEngine.dispatch` 把 CLI 投递直接交给 `run()`。核心的提交是同步的，所以微任务顺序就保住了派发顺序。核心账本给这些轮次排序；核心的 key 去重加上房间的 `claimed` 集合，让同一投递提交两次也只是一个执行。`queues`/`scheduled` 只给房间自己的 agent 留着，改名 `agentQueues`/`agentScheduled`。房间的 agent 不是 CLI 成员，它的路径不变。`inFlight` 只作 `idle()`/`hasPending` 的跟踪，不是队列。`holdRun`/`releaseRun` 现在记进 `followed` 集合（服务正在跟的外部轮次）。
- **一轮的下落由核心说**（`src/core-ledger.ts`：`CoreLedgers`、`reconcileCore`）。`recover()` 读每条 CLI 投递在账本里的行，先按运行的 `executionId`，没有时按 key = 投递 id：
  - `uncertain` → 写 `room/delivery-state uncertain`，再写一条 failed 运行边（`RESTART_UNKNOWN_TEXT`）关掉卡片；
  - `done`/`failed`/`cancelled` → 写这个结果，行上的 `error`（对账证据）作文字，再写终态运行边；
  - `queued`/`running` → 不动；
  - 没有行的排队投递 → 用同一个 key 重新提交。

  本进程自己在跟的行跳过。外部轮次（`execution:<id>`）按执行 id 同样处理。`recover()` 每个房间一次只跑一遍。
- **投影读核心**（`view()`）。账本行为 `uncertain` 的 CLI 运行或投递投影成 `uncertain`（`RoomMemberRun` 上新增的只用于投影的状态，日志里永远不写）。核心已结束或已对账的，投影成那个结果。成员有不确定行时，它排队中的投递带 `waiting: 'reconcile'`。活房间的 `getState` 发现日志落后于核心（`behindCore`）时跑一遍恢复，所以成员页的对账在下一次读取时就进房间记录。
- **只有一个对账动作。** `reconcileDelivery` 先调 `reconcileExecution`，核心接受了才写房间日志；核心拒绝时返回 `reconcile-failed`。从丢失轮次「往前走」（人发新消息、跨房间求助进来）、停掉它的任务、对账正式目标的尝试，也都会结掉核心那一行。在成员页或编辑弹窗里对账，经投影加 `behindCore` 传到房间。决定 3 在各个方向都成立。
- **成员在等对账时，房间的活不算失败。** 核心因成员有不确定行而拒绝某条投递时，投递保持排队（不写投递边）。房间只写一条带 `MEMBER_WAITING_TEXT` 的运行行，投影成 `uncertain` + `waiting: 'reconcile'`。那一行对账后，恢复会重新提交这条投递。旧式 relay 没有可等的投递，仍以 `MEMBER_UNRECONCILED_TEXT` 失败。`settle()` 现在忽略早于该运行最近一条 running 边的终态边；同一 run id 重新开始时，回放丢掉之前的失败原因。
- **核心为已对账的执行补上 end**（S4 偏差 5，现已做）。账本行记下 `reconciledAt`。`ExecutionRecorder.closeReconciled` 为每个「有 start 没 end、账本行已对账」的执行写 `local-agent/execution` end 记录：`reconciled: true`、对账结论作 outcome、执行区间里的轮次、`endedAt` = 对账时间。子会话在内存里时由 `reconcileExecution` 立刻写，否则在该成员下一次准入、写 start 之前写。本进程里仍打开的执行从不碰。改动很小，让读者（lens、`readExecution`）看到闭合的日志，也不需要宿主改动。
- **兼容。** 房间在账本里找不到对应行的 running 投递或运行，仍走旧判定（投递 uncertain、运行 failed）。这些是部署前就在跑的轮次，或没有账本的核心。代码标了 `COMPAT(batch 5 S7, remove one release after)`。
- **客户端。**
  - `RoomRunView` 用节点新增的 `runId` 去 `executions` 里找自己的卡片。投影为 `uncertain` 时显示「{member} 的这一轮待对账」加一行提示，没有停止按钮。等待行显示「{member} 待对账，这条消息还没发出」；运行重新开始后，被取代的等待行隐藏。
  - `RoomDispatchView` 对正在等待的收件人显示「待对账」，不再显示「排队中」。
  - 输入框上方协调者的队列把等待行算作被挡住。「继续」覆盖投影为不确定的房间运行，不覆盖外部轮次。
  - 团队页成员状态显示「待对账」。

## 考虑过的其他方案

- **保留 `scheduled` 作进程内去重。** 按设计稿否决。防双重准入靠核心的 key；从核心结算到房间写边之间的空档由 `claimed`（本进程在跟的执行 id）覆盖。`claimed` 现在要等结果写进日志后才释放。
- **把 `uncertain` 作为运行状态写进日志。** 否决：那会改 room→lens 契约和所有读运行状态的地方。日志照旧用带重启原因的 `failed` 关掉卡片，「待对账」由投影从核心读出。
- **把被拒的投递显示成 `uncertain` 投递**（S5 也否决过）。那会给一条从没跑过的轮次提供房间的「它跑了，记下结果」。标为等待中的排队投递才准确。
- **为写对账 end 专门把冷子会话接回来。** 不需要。下一次准入本来就会接回，补写在它的 start 之前，不用第二条接回路径也能保证顺序。

## 后果

- 用户可见（准确）：
  1. 重启后，跑到一半被打断的房间轮次显示「{member} 的这一轮待对账 · 重启打断了这一轮，结果不确定。在成员编辑弹窗的「待对账」里核对并填写结果」（警示色、无停止按钮）。以前显示「{member} 运行失败 · Execution outcome is unknown after restart…」。成员页显示「待对账」而不是「失败」。
  2. 成员页或房间的 agent 开的一轮，被重启打断后也显示同样的「待对账」（以前是失败）。
  3. 给有这种轮次的成员发消息，不再以「没有发出：…再重新发送这条消息」失败，而是显示「{member} 待对账，这条消息还没发出」，成员间派活行显示「待对账」。在任一处对账后，消息自己发出。
  4. 在房间的对账卡片里对账，编辑弹窗和成员页的「待对账」一起解除，反之亦然。从丢失轮次「往前走」的新消息不再被核心拒绝。
- 核心领先于日志时，活房间的 `getState` 现在可能写入（跑一遍恢复）。冷房间仍只投影。
- room 测试里的 `run-entry-shim.ts` 现在自带账本（`readMemberInbox`、`reconcileExecution`、`seedLedgerRow`），除非用例自己脚本化这些方法。
- Context Lens 源码未改。room→lens 夹具没变（契约用例里没有重启）。

## 测试

- `packages/room/tests/dispatch.host.spec.ts`（新增「restart recovery through the core ledger」一组，8 条）：
  - 不确定行投影成「待对账」且无副作用，恢复跑两遍都只写结论、不跑任何轮次；
  - 房间对账结掉核心那一行，排队投递随后只跑一次；
  - 核心拒绝对账时房间不动（`reconcile-failed`）；
  - 成员页对账经 `getState` 解除房间的「待对账」；
  - 核心已跑完、房间还没记的投递照核心记下，绝不重跑；
  - 重启时被丢弃的排队投递按 key 重提交，并发和重复的恢复下只跑一次；
  - 外部轮次从「待对账」到对账为完成；
  - 人往前走时核心行被取消。

  另外：成员页不确定的用例现在是等待（排队加一条「待对账」行），对账后发出一次；旧式 relay 仍带指引失败。
- `packages/room/tests/real-core.host.spec.ts`：崩溃辅助函数丢掉旧房间的写入，卸掉房间和核心，恢复账本文件，再装新的核心和新的房间模块。两条用例取代 S5 的拒绝用例：
  - (a) 被打断的工具轮次在房间和核心都显示「待对账」；房间消息等待而不失败；成员页对账后它只跑一次，子日志多一条 `reconciled: true` 的 end；
  - (b) 被打断的房间投递：核心和房间都说不确定，重复的恢复不跑任何轮次，排队的第三条被核心丢弃；房间对账结掉核心那一行（`reconciledAt`），第三条只跑一次，子日志闭合被打断的执行（`reconciled: true`、`turns: [2]`）。存下的日志都过 `assertReleasedV4Relationships`。
- `packages/room/tests/jobs.host.spec.ts`：往前走和停止任务也会结掉核心那一行。
- `packages/room/tests/room-recovery.client.spec.tsx`：新增 4 条（不确定卡片、对账后隐藏、等待行及其被取代、派活行）。
- `packages/local-agent/tests/execution-records.spec.ts`：`closeReconciled`（对账前不写、幂等、在下一个 start 之前、从不碰打开的执行）。`run-entry.spec.ts`：不会写第二条 end，`reconciledAt` 已设。
- local-agent 527 → 528，room 515 → 529（51 个文件），context-lens 311 未变且全绿。room→lens 夹具未变。
- 截图（未提交），来自 `packages/room/tests/preview/recovery.html?state=timeline|dialog`，1280 与 390 宽：`/tmp/s7-recovery/{timeline,dialog}-{1280,390}.png`。
- 未验证：真实 CLI 轮次跨真实宿主重启、线上 3080 实例、编辑弹窗对接活网关。

## 部分被取代

2026-11-09 起，本篇的对账部分被[重启恢复收敛](2026-11-09-restart-recovery-consolidation.zh.md)取代：重启不再让账本行变成 `uncertain`（关成 `cancelled` + `interrupted: 'restart'`，不挡任何东西），没有开机暂停，`reconcileExecution`、网关的 `reconcile`、房间的 `reconcileDelivery` 只作为拒绝保留一个版本。账本本身——每个成员一条队列、key 去重、持久化拆分、S7 的「房间照核心说的记」——不变。Testing 里提到的预览页 `packages/room/tests/preview/recovery.html` 已删除；`restart.html` 展示收敛后的界面。
