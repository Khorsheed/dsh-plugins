# Agent Note: room 的每一轮成员执行都走核心的 `run()` 入口

Status: implemented

## Problem

批 5（统一执行入口，设计稿 `proposals/active/2026-11-03-unified-execution-entry.md`，不在仓库里）的 S5。S4 之后，宿主 `subagent` 工具和成员页输入框都经 local-agent 的唯一入口 `run()` 与每成员账本找成员，room 却还自己调 facade `start`/`resume`。所以首轮还是续聊由 room 判断。room 留着一条所有 provider 都已用不上的 `!controlled` 分支。新成员后续的派活要在 room 里等首轮 handle 发布（`freshStarts`、`submitted` 两步放行）。room 的每一轮也都没告诉核心为什么跑、为哪个任务跑：执行记录上写着 `caller: 'api'`、没有起因；重试的房间投递没有 key，没有东西能挡住它被准入两次。成员有一轮待对账时，room 的派活只得到一句英文报错。房间主 agent 用 `subagent` 工具续聊成员的那一轮，房间里也看不到（用户决定 2026-11-03 ④ 要求能看到）。

## Decision

- **唯一入口**。`DispatchEngine.runCliMember` 对 CLI 成员的每一轮都调 `localAgent.run()`：人类消息、成员间消息、外来求助、汇报、放行轮、旧 relay、邀请时的首个任务、重试，以及 `/compact`（`operation: 'compact'`）。请求带 `caller: 'room'`、成员的稳定子会话 id、`cause`、`task`、`key`、`callerRef`、`signal` 和 `on.admitted`/`on.progress`。room 的 facade 探测（`adapter.ts`）现在要求有 `run`。没有它的核心，对 CLI 成员显示为「local-agent 不可用」。
- **稳定的子会话 id**。`member.childSessionId ?? <房间成员 id>`，与 `prepareMember` 预留的 id 相同。首轮的子会话由核心按这个 id 建出，所以后续轮次在 handle 进日志之前就能点名这个成员。`freshStarts`、`startingMembers`、新成员的 `submitted` 挡位都已删除。`memberMode` 用这个 id 认出首轮的提问者，`cancel` 也用它够到首轮。
- **续聊不传 scope、cwd、model**。`member.create`（`label`、`model`、`effort`、`cwd`）只给还没有子会话的成员。预备好的成员只给 `{ label }`。续聊的成员不给 `create`，核心从记录里取 scope/cwd/model（R5）。
- **提示词延后拼**。提示词（简报或变动、通知、攒着的汇报）在核心把这一轮排到该成员队首时才拼。等待期间已结算的投递（移除成员、继续后被取代）或成员已被移除的，在这里中止，不写任何事件。`!controlled` 分支已删：room 的 running 边只在 `on.admitted` 里写。provider 发布了 run 却没报准入时，room 在 run 发布时补写。
- **room 的队列仍在账本之上**。每成员的提交链在 `run()` 返回（即这一轮已持久入队）后立即放行，之后由账本排序。room 自己的 `queues`/`scheduled`、running→uncertain 恢复、R2 用量抄写都不动（留给 S6/S7）。
- **不会准入两次**。`key` = 投递 id `<派活 seq>:<成员 id>`（旧 relay 为 `relay:<relay ids>`），`callerRef` = run id。同一投递提交两次，核心交回同一个执行。模块级的 `claimed` 集合让第二个 room run 什么都不写。
- **`room/run-state.executionId`**（已登记事件上的可选字段）写在 running 边和每条终态边上。带执行 id 的 run，`childTurn` 取自该执行记下的轮次。引擎用 settlement 的 `turns`。对账、停止路径用子会话里 `local-agent/execution` 的 end 记录；执行还没结束时，用它 start 记录之后的 turn/start。`childFromSeq`（现在取核心准入时给的值）只给没有执行 id 的 run 当区间用，即房间自己的 agent 和 S5 之前的 run。
- **`room/dispatch.releaseReason`**（可选：`timeout` | `manual` | `restart`）记下放行轮为什么唤醒接收方，让它的起因是事实。
- **用户能处理的拒绝**。成员账本里有 `uncertain` 行，导致 `run()` 拒绝或这一轮没开始就结束时，房间投递和 run 以 `MEMBER_UNRECONCILED_TEXT` 失败。这段文字说明这条没有发出，并指向编辑弹窗的「待对账」。输入队列暂停时给 `MEMBER_PAUSED_TEXT`。
- **别处发起的轮次在房间里显示**。room 在 `session/event` 上看 `local-agent/execution` 的 start/end 记录。满足以下条件的 start 记录会得到一张运行卡：caller 不是 `room`、父会话是在线的房间、子会话属于某个 CLI 成员、准入不超过 60 秒（不是加载时重放的日志）。运行卡的 run id 为 `execution:<executionId>`，带 `executionId`、`childFromSeq` 和子会话 id。成员显示忙碌，停止按钮能够到它，恢复投影让它保持运行中。收到 end 记录时，room 把回复写成 `room/speech`（只限 prompt 轮），并写一条带 `childTurn` 的终态边。这类轮次来自宿主 `subagent` 工具和成员页输入框。不写房间投递、汇报或任务：这份活属于发起它的调用方。

## 起因与任务映射

| 房间事实 | `cause` |
|---|---|
| `human` 派活（含 `/compact`） | `{ kind: 'human', sessionId: 房间, dispatchSeq, via: 'room', messageId? }` |
| `coordinator` / `member` / `relay` 派活 | `{ kind: 'member', sessionId: 房间, fromMemberId: dispatch.from, dispatchSeq }` |
| `help` 派活 | `{ kind: 'help', sessionId: 房间, helpId: help.id, fromRoom: help.room }` |
| 某次投递的 `report` | 源 run 的 `{ kind: 'execution', executionId }`。源没有执行 id（房间自己的 agent、S5 之前）：按汇报成员 id 记 `member` |
| 求助线程的 `report`（`help:<id>`） | `{ kind: 'help', helpId, fromRoom: <帮忙的会话> }` |
| 放行轮，`restart` | `{ kind: 'restart', sessionId: 房间 }` |
| 放行轮，`manual`（现在交给） | `human`，via `room` |
| 放行轮，`timeout` / 未记录 | 针对该接收方最近一次 `report-timing`「later」决策的 `{ kind: 'decision', decisionId }`。没有记录：不写起因 |
| 旧的已确认 relay（没有派活事件） | `member`：relay 发送者的 id（否则名字），`dispatchSeq` = relay 事件的 seq |

派活写了任务时，`task` = `{ sessionId: 房间, id: dispatch.task }`。这张表由 `dispatch.ts` 的 `executionFacts()` 负责。

## Alternatives considered

- **保留 `start`/`resume`，只加 cause/task 选项**。否决：room 仍要判断首轮还是续聊、续聊时传 cwd，也仍需要新成员的挡位。设计的要点就是只由核心判断。
- **现在就删掉 room 的队列**。本步不做。room 的 `queues`/`scheduled` 与 uncertain 处理在 S7 随按 key 恢复一起删。单独删掉会让 room 既没有进程内去重，也没有恢复路径。
- **把拒绝显示成房间投递的 `uncertain`**。否决。房间投递的 uncertain 提供的是 room 自己的对账（「它跑过，记下结果」），可这一轮根本没跑过；它还会挡住之后发给该成员的所有房间投递。失败行加上指向「待对账」的原因才准确。
- **为别处发起的轮次加核心事件或回调**。不需要。核心已经把 `local-agent/execution` 写进成员会话，room 也已经在听 `session/event`。room 显示的就是核心记下的内容，不需要新接口。
- **所有 run 都从 `childFromSeq` 读 childTurn**。按设计否决。执行的轮次是写下的事实，seq 区间只是批 4 给没有执行的 run 用的回退。

## Consequences

- 用户可见：被拒的一轮现在显示「没有发出：该成员有一轮被重启打断、结果不确定。请在成员编辑弹窗的「待对账」里核对并填写结果，再重新发送这条消息」，不再是英文报错。房间 agent（或成员页）对成员发起的一轮，在房间里显示工作中的卡片和回复。给还没开始过的成员连发两条，两条会同时进核心的队列（不再在 room 里等）。第二条仍在第一条之后、作为续聊执行。
- 没有 `run()` 的核心（早于 S4）会让本版 room 的 CLI 成员不可用。两者都在本仓、一起发布。
- 本次改动之前记下的放行轮没有 `releaseReason`，起因回退为最近的暂缓决策，或者不写。
- 重启时仍在跑的别处发起的轮次，被 room 的恢复视图投影为失败；核心账本显示 uncertain，S7 再统一。
- room 测试用 `tests/run-entry-shim.ts`，它是叠在各 spec 脚本化的 `start`/`resume` mock 之上的 `run()` 替身。它保持每成员一条严格队列、延后求值的输入、key 去重、准入，以及子会话里的 start/end 记录。各 spec 仍按原样编排 provider 轮次。

## Testing

- `packages/room/tests/dispatch.host.spec.ts`：每一轮都经 `run()`，带映射好的 cause/task/key/callerRef（邀请、成员消息、汇报 → `execution`、带 `messageId` 的人类消息）。有一张单元表，覆盖求助、求助回复、放行轮 `timeout`/`restart`/`manual`、S5 之前的汇报、旧 relay。有待对账执行的成员得到「待对账」失败，什么都没发出。第二个引擎在核心还持有时重放同一投递，只准入一次（provider 调一次，running/done 各一条）。别处发起的 `tool` 轮显示 running 边、发言和终态边，房间自己的轮次和重放的历史不显示。新成员的两轮都以成员 id 到达核心，第二轮续接第一轮。区间测试现在也钉住两条边上的 `executionId`。原有场景只在账本严格串行处做了调整。
- `packages/room/tests/jobs.host.spec.ts`：一个任务的两轮都写着这个任务，起因分别是 `human` 和 `member`。
- `packages/room/tests/lens-contract.host.spec.ts`：契约流程里每条 running 边都带互不相同的 `executionId`，每个 prompt 轮的终态边都有 `childTurn`。夹具 `packages/context-lens/tests/fixtures/room-contract.json` 已用 `UPDATE_ROOM_CONTRACT=1` 重生成：多了 `executionId`，子会话 seq 因执行记录后移。Context Lens 源码未改，测试全绿（311）。
- `packages/room/tests/service.host.spec.ts`：`memberMode` 用成员 id 认出首轮的提问者，两个首轮同时进行时也一样。
- `packages/room/tests/real-core.host.spec.ts` 让 room 跑在真实的 local-agent 核心上：真实的注册表及其 `run()`、账本、`MemberControls` 准入和执行记录，持久化用临时目录里的 JSONL。只有一个假的家族 provider，它把每一轮挂起（不跑 CLI，不调模型）。覆盖四种情况。一次人类派活是一个执行：start 记录带 `caller: 'room'`，起因为 `human`/`via: 'room'`/`dispatchSeq`，带 `callerRef` 和账本 key `<seq>:<成员 id>`，run-state 边带 `executionId` 和取自 settlement 的 `childTurn`。第二个引擎把同一投递再提交一次，仍是一个执行、一轮 provider、一对 running/done。同一成员上的 `tool` 轮和排队中的房间轮严格先后执行：房间把 tool 轮显示成它自己的卡片和终态边，排队的房间轮随后续聊。核心重启后留下一轮 `uncertain` 的 tool 轮，核心拒绝下一轮房间派活，房间记下 `MEMBER_UNRECONCILED_TEXT`。它存下的每份子会话日志都通过 `assertReleasedV4Relationships`，没有被隔离的。
- room 490 → 500，全绿。local-agent 518、claude-code 281、codex 278、kimi 325、dsh 246、bundle-local-agent 5、context-lens 311 都没变，全绿。`pnpm check:plugins` 无发现。
- 真实核心的测试没有发现缺陷。它顺带暴露一点，早在 S5 之前就存在：准入前被拒的房间轮只有一条 failed 的 run-state 边，没有 running 边。房间的 `runs` 投影里仍保留该成员的上一轮，所以被拒的这一轮表现为时间轴上的失败行和失败的投递。
- 未验证：真实 CLI 一轮、3080 上的实例。别处发起的轮次卡片没在浏览器里看过。真实核心测试里的 tool 轮是按工具的方式以 `caller: 'tool'` 直接调 `run()`，没有经过宿主的工具运行时。
