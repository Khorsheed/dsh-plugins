# Agent Note: 被重启打断的一轮关掉，成员自己核对后接着做

Status: implemented

[English](2026-11-09-restart-recovery-consolidation.md) | [中文](2026-11-09-restart-recovery-consolidation.zh.md)

## Problem

2026-11-09 之前，被宿主重启打断的一轮成员工作是**结果未知**，要有人来对账。local-agent 核心把那一行改成 `uncertain`，开机暂停该成员的队列，并拒绝该成员之后的一切准入；房间把「待对账」投到投递、运行卡片、回执、两个胶囊和一个兜底面板上，还把英文「Execution outcome is unknown…」当作*回报*发给派活人；正式目标暂停，把那次尝试标成 `uncertain`，直到人填证据选「待验收」或「失败」。被问「做完没有」的是人——而只有成员能回答（它的文件、测试、提交、部署）。房间 6a56367b（2026-11-09）里，人填的「证据」是「不确认是否做完」；目标不知道成员页上做过的对账；一次被取代的目标尝试永远停在 `queued`；协调者收到五条一模一样的释放提醒和两条不是回报的「回报」；而接着做完的那一轮真正的结果没有交给任何人。

设计稿：`proposals/active/2026-11-09-restart-recovery-consolidation.md`（十个待定项 2026-11-09 全部按建议采纳）。本篇取代 2026-09-19 拒绝「把被打断的工作当作取消」的决定（[房间重启对账](../bug-fix/2026-09-19-room-restart-reconciliation.zh.md)），并撤回[核心里的队列与恢复](2026-11-05-queue-and-recovery-in-core.zh.md)的对账部分。

## Decision

**一条规则。** 被宿主重启打断的一轮关掉，记为「被重启打断」——和完成、失败、取消并列的一种结果，不是未知。接着做是新的一轮，成员先核对已经做完的部分。房间的自动继续、人按「全部继续」、目标开新尝试是同一个动作；除此之外人只有「停止」。没有任何东西等着被打断的那一轮被「消掉」：它不挡准入、不暂停队列，派活人只会通过接着做那一轮的正常回报听到结果。

### 核心账本（R2，local-agent）

- **载入。** 账本文件载入时仍是 `running` 的行，不论谁提交的，都关成 `status: 'cancelled'`、`interrupted: 'restart'`、错误「被重启打断」、`settledAt`。CLI 自己开的轮保持原来的结局（`failed` + `SELF_ROUND_RESTARTED`）。旧核心留下的 `uncertain` 行同样关掉（看数据，不看日期），且不算本次重启的。
- **没有开机暂停。** 核心开机不再暂停账本；带旧核心 `pausedBy: 'restart'` 的文件载入后不暂停。人自己按的暂停（没有 `pausedBy`）不动。`assertAdmission`、`pump`、`runNow`、`resume` 不再有 `uncertain` 分支。
- **M10。** `interruptedMembers()` 列出：本进程载入时关成被打断的行（`interrupted === 'restart'` 且在 `cutOffThisBoot` 里）的成员，或磁盘上仍写着 `running`、且开始于上一个宿主进程之后的未载入文件的成员。
- **执行记录。** 被打断的执行写 end `{ outcome: 'uncertain', reconciled: false }`——与被重启打断的 CLI 自开轮同一个出口，Context Lens 已把它读成「停了」。
- **成员页的轮自动续接。** 本次重启打断了一行 `composer` 时，载入在队列头部插一行续接（`caller: 'composer'`、房间那句继续说明、`preview: '重启后继续'`、key 为 `restart-continue:<行 id>`），人排在后面的输入跟着走。人自己暂停了队列，或这次重启是该成员自己那一轮发起的（`selfRestartGuard` 的记录），则不续接。排着的成员页输入在账本载入后自动重放（要求提供方已注册）。
- **`subagent` 工具和插件的轮只关掉。** 父会话那一轮已随重启结束，要不要重做由父代理决定。关掉的行不再挡该成员的房间工作。
- **兼容。** 行保留旧核心认得的 `cancelled` 状态（新状态值会让旧核心的 `validRow` 判整个账本无效）。`reconcile` / `reconcileExecution` / 网关 `controlMemberInbox(…,'reconcile')` 保留一个版本，回答原来的拒绝——载入后没有任何行是 `uncertain`。

### 房间（R3）

- **一个读取口。** `restart-interrupted.ts`（服务端与浏览器共用）回答「这一轮是不是被重启打断的」：新标记 `room/delivery-state` / `room/run-state` 上的 `endedBy: 'restart'`（已有事件的可选字段，不登记新事件类型），或任何旧形状——投递的 `uncertain` 边、带旧英文原因的失败运行卡片、「按没做完处理」/「任务已被停止」的取消、「被取代」的排队消息。看数据，不看日期。`RoomDelivery.interruptedAt` 记下打断第一次被记进日志的时间，改写旧边不会让旧的一轮看起来像这次重启的。
- **恢复只关掉，不回报。** 核心行被关成被打断（或旧核心留下 `uncertain`）的投递、核心没有行的运行中投递（房间自己的代理、S7 之前的投递）、旧的 `uncertain` 边，在投递和它还开着的卡片上写 `cancelled` + `endedBy: 'restart'`。不给派活人发任何回报。人以前在核心里对过账的结论，照那个结论记。投影（`view`）把每种形状都读成 `cancelled` + `endedBy: 'restart'`，不再产生 `waiting: 'reconcile'`。
- **作废的重启回报不再送达。** 排着的回报若正文是旧的「Execution outcome is unknown…」「被重启打断前排队，已被后续消息取代」「已并入下一条消息一起送达」或「Human reconciled task …」，关掉（`OBSOLETE_RESTART_REPORT_TEXT`），不送。
- **排在被打断那轮后面的等它被继续。** 成员有一轮被打断、还没继续也没停止的消息轮（`openInterruptedRounds`）时，只准入 `continues` 它的派活，其余照常排队。房间自动继续在一个同步段里追加并派出续接消息，然后跑一次恢复：续接排在该成员核心队列最前，后面的按顺序跟上——不合并、不取代（待定 4 选 B）。
- **中断后的第一条消息就是继续（D-4）。** 人发的消息、编辑后的消息、迟到的回答、跨房间求助、协调者或成员派的活，发给这样的成员时都记 `continues`；`assemblePrompt` 在正文前加一行（「你上一轮被实例重启打断了。先核对上一轮已经做过什么，再处理下面这件事。」）。续接消息本身和目标的新尝试用自己的话说。
- **续接的结果交回原来的派活人（D-3）。** `continues` 了某成员被打断投递的那次派活结束时，按那条原投递发跟进回报（`reportFollowUp`，以续接投递为键）：收件人、任务、目标节奏都沿用原投递。续接派活自己就会回报给同一个人时不重复。
- **人的两个动作。** `continueInterrupted`（「全部继续」：与房间自动继续同一条续接消息，记 `continues`；目标则恢复）和 `stopInterrupted`（「停止」：每一轮再加一条关闭边 `RESTART_STOPPED_TEXT`，派活人收到一次「被重启打断，已停止」，排在后面的照常送出）。停任务（`stopJob`）对其中被打断的轮同样处理。任务不会因为被打断的轮变成「需要处理」。
- **删除。** `moveOnFromLostRounds`（关掉、合并、取代）、`supersededByMoveOn`、`waitForReconcile` 和待对账拒收（`MEMBER_UNRECONCILED_TEXT`）、`reconcileInCore` / `reconcileCore`。`reconcileDelivery` 保留一个版本，回答 `delivery-not-uncertain`。核心因人手按的暂停拒收时仍读作 `MEMBER_PAUSED_TEXT`（措辞改掉「重启后」）。

**R2 与 R3 必须一起部署。** 只上 R2 时，房间还在等核心说 `uncertain`，会把关掉的行当普通取消，自动继续失效。房间与 local-agent 家族一起部署。

## Alternatives considered

**账本新增状态 `interrupted`。** 否决：旧核心的 `validRow` 遇到不认识的状态会判整个账本无效，回退后该成员的一切准入都被挡住。`cancelled` 加可选标记两边都读得对。

**保留人工对账，只改显示位置。** 否决：事故里的对账是猜的。证据在成员手里，不在人手里。

**跨重启续接同一轮。** 做不到：没有哪个 CLI 能接上中途被切断的一轮；接着做永远是新的一轮。

**把排在后面的消息并进续接消息（待定 4 选 A，旧的「按没做完处理」做法）。** 否决：它需要合并、「被取代」地关掉旧 move-on 漏下的行、以及每条并入消息的回报对应关系；目标尝试本来就不能合并。现在排着的消息等续接跑完后逐条送达——多跑几轮，代码少得多。

**`subagent` 工具的轮也续接。** 否决（待定 3）：父会话的工具调用已经没了，续接结果没人收；父代理若重发同一调用还会和续接撞车。

## Consequences

- 成员可能把重启前已做过的外部动作再做一遍（发布、部署）。续接说明要求先核对；不能安全重复的工具应补自己的幂等，而不是回到人工把关。
- 重启后自动发起的付费轮次变多（成员页续接）。上限：每行每次重启最多续接一次、自启重启守卫、人自己的暂停。
- 回退 R2 后被改写的行仍是 `cancelled`：旧房间把它们当普通取消，给派活人发「已取消」——多一条噪音，不阻塞。

## Testing

- `packages/local-agent/tests/member-inbox.spec.ts`：运行中的行对任何调用方都关成被打断、不挡任何东西；成员页续接排在队首、先于人打的输入执行；人暂停、自启重启的成员、工具发起的轮都不续接；旧核心的账本（夹具 `tests/fixtures/restart-ledgers.ts`）关掉 `uncertain` 行、解除开机暂停、重放被挡住的输入；`interruptedMembers` 只算本次重启的行。
- `packages/local-agent/tests/run-entry.spec.ts`：经真实 registry，被打断那行的 key 读作那次已关掉的执行，下一条房间派活立即准入。
- `packages/room/tests/restart-recovery.host.spec.ts`：一轮被打断期间派活人什么都收不到，自动或人按继续的那一轮结束后恰好收到一条正常回报（`followUpOf` 原投递）；「停止」只发那一句并放行排队；夹具里作废的回报被关掉，旧的「按没做完处理」那一轮不再被列出。
- `packages/room/tests/restart-interrupted.client.spec.ts`：新标记与四种旧形状；已处理的轮；作废回报。
- `packages/room/tests/dispatch.host.spec.ts`、`real-core.host.spec.ts`、`jobs.host.spec.ts`、`help.host.spec.ts`：恢复关掉、不重放不回报；续接先跑、排队跟上；人发消息和跨房间求助算作继续（D-4）；真实核心立即准入下一条，并为被打断的执行写 `uncertain` 的 end。
