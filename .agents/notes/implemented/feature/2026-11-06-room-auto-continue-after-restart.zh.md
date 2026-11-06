# Agent Note: 房间替你继续被重启打断的成员

Status: implemented

## Problem

宿主重启会打断当时正在跑的所有成员轮次。批 5 S7 之后，这样的轮次显示为「待对账」（local-agent 核心账本里的 `uncertain`）。输入框上方会出现「N 位成员被重启打断：… · 全部继续」。按下按钮就以人的身份给这些成员发「继续」，这条新消息会「按没做完处理」掉丢失的那一轮（[排队与恢复归核心](2026-11-05-queue-and-recovery-in-core.zh.md)）。在有人打开房间并按下按钮之前，什么都不会发生。为了部署而重启 3080 的用户，或者宿主夜里崩了的用户，回来看到的都是一群闲着的成员。

成员自开轮设计（`proposals/active/2026-11-06-member-self-started-rounds.md`，不在仓里；E 节、步骤 M9）决定让房间自己按这个按钮。用户 2026-11-06 定了以下几点：

- 做成房间设置，默认开启。
- 机制只有一套，与「全部继续」共用；开关只决定谁来按。
- 每个被打断的轮次最多自动继续一次。
- 触发这次重启的那一轮绝不自动继续。
- 输入队列暂停或房间暂停时跳过。
- 这条消息显示为「房间 · 自动」，正文看得见。

## Decision

- **一条共用的规则**（`packages/room/src/restart-continue.ts`）。
  - `interruptedRounds(state)` 列出每个成员最近一轮被重启丢了结果的房间轮次：`uncertain`，或带重启原因的旧式 failed。它跳过别处发起的 `execution:` 轮次、等对账的行，以及已经有消息继续过的轮次（`RoomState.continued`，从每条派活的 `continues` 折叠而来）。
  - 某条护栏成立时，该轮带上 `blocked`：
    - `again`：它的投递本身就是自动继续；
    - `self-restart`：成员的子会话就是记录下的重启发起者；
    - `queue-paused`：核心里该成员的输入队列暂停中；
    - `room-paused`：房间暂停中。
  - 开关关闭时 `autoContinueRounds` 为空。开着时，它是没有被挡、带 run id、且不是正式目标尝试的那些轮次。正式目标尝试保留显式对账。
  - 输入框横幅和服务端自动继续都调用这条规则。原来写在输入框里的筛选已经删掉。
- **设置。** `room/settings.autoContinueAfterRestart?: boolean`。缺省即开，所以已有的房间也是开。`RoomSettings.autoContinueAfterRestart` 是折叠后的值（默认 `true`），`setSettings` 接受这个字段。开关在成员页签的「协作设置」里，属于「自动判断」分组，放在汇报时机下面。
- **服务端替你按**（`RoomService.autoContinue`，在 `ensureLive` 和冷房间 `resumeRoom` 的 `engine.recover()` 之后）。
  - 它读 `autoContinueRounds(engine.view(...))`，按投递的任务给轮次分组。
  - 每组先像人的消息一样「按没做完处理」丢失的轮次（`moveOnFromLostRounds`，同时结掉核心那一行；文案 `AUTO_CONTINUE_MOVED_ON_TEXT`），再追加一条 `room/dispatch`：`origin: 'human'`、`via: 'auto-continue'`、`continues: [runId…]`、任务和 `RESTART_CONTINUE_TEXT`，然后经引擎派发。
  - 从读取到追加全程同步，所以并发的另一遍会看到 `continues`，找不到要做的。协调者交接进行中时跳过。
  - 投影里有要继续的轮次时，`getState` 会触发一次活访问。重启后打开冷房间就足以让它跑起来。
- **已登记的 `room/dispatch` 上加两个可选字段。** `via?: 'auto-continue'` 和 `continues?: string[]`（被打断的 run id）。人按「全部继续」时也写 `continues`：`postMessage` 接收 `continues`，只记录属于目标成员的被打断轮次。两条路径只差 `via`。`executionFacts` 把 `via: 'auto-continue'` 映射到已有的 `{ kind: 'restart', sessionId }` 起因，不新增起因。`RoomDelivery.via` 会投影出来。
- **继续消息**人按和自动用同一句话：说明实例重启打断了你；先核对文件、测试、提交、部署；做完的步骤不要重做；丢失的后台任务不会重跑。服务端是 `RESTART_CONTINUE_TEXT`，客户端 zh 的 `composer.continueText` 也是这句。en 版意思相同。
- **投影事实**（`RoomState.restartFacts`，由 `engine.view` 给出）。`queuePaused` 是核心输入队列暂停的成员 id（`CoreLedgers.paused`）。`restartInitiator` 来自对可选服务 `selfRestartGuard` 的 `lastRestart()?.initiatorMember` 的鸭子类型探测。目前没有哪个 guard 提供这个读法（M10 才加 `initiatorMember`）。没有 guard 或没有这个读法时，视为不是成员自己触发的重启，靠「每轮最多一次」把最坏情况限制在多一次重启。
- **客户端**（纯状态 `client/restart-view.ts`，组件 `client/RoomRestart.tsx`）。
  - 自动继续的投递还在排队或运行时，输入框横幅显示「重启后已自动继续 N 位成员 · 设置 ×」。关掉后按房间和派活 seq 记在 `localStorage`。
  - 手动横幅显示「N 位成员被重启打断：… · 全部继续」。开关关闭时列出所有轮次，和以前一样。开关开着时只列被挡下的（各带原因）和正式目标尝试。只有一位成员被挡时读作「X 被重启打断」再加原因。
  - 时间线行 `room-auto-continue` 由自动的 `room/dispatch` 认领，显示「已自动继续：A、B（重启打断）· 设置」这一行，以及消息卡片「房间 · 自动」和完整正文。
  - 成员页签那一行在这一轮结束前显示「重启后已继续」，否则显示「被重启打断」加「等你决定」或原因。
  - 「设置」原地展开开关。

## Alternatives considered

- **放在客户端做。** 设计已经否掉：多个浏览器同时打开会各按一次。`recover()` 在服务端每遍只跑一次，`continues` 让重复的遍幂等。
- **新的派活来源（`room`）或新的执行起因。** 不采用。读 `origin` 的地方（任务归类、团队树、lens 契约）本来就把 `human` 当作「不汇报给谁」。设计把自动按映射到已有的 `restart` 起因，用 `via` 就足以区分谁按的。
- **所有成员一条派活。** 一个 `task` 装不下属于不同任务的成员，所以每个任务组一条派活、一行时间线。常见情况（同一任务）只有一行。
- **「设置」跳到成员页签。** 宿主只把 `openView` 交给会话视图，聊天行和输入框都切不了页签（评测插件碰到过同一堵墙）。所以改为原地展开开关，标题和说明与设置行一致。
- **把房间即将自动继续的轮次也放进手动横幅。** 不采用。人如果在 `getState` 和房间自己那一遍之间按下去，消息会发两次。

## Consequences

- 用户可见：
  1. 重启后打开房间（或任何修改操作）会把被打断的成员各继续一次，用新的那句话。时间线显示「已自动继续：…」和来自「房间 · 自动」的消息，输入框显示「重启后已自动继续 N 位成员」。
  2. 人按「全部继续」现在发的是同一句较长的消息，不再是「继续」。
  3. 自动继续后又被打断、成员输入队列暂停、房间暂停、或记录到是成员自己触发的重启时，落回手动横幅，并用一句话写出原因。
  4. 新增设置项「重启后自动继续」。
- `setSettings` 写入前会先做一次活访问。对重启后还没打开过的房间关掉开关，会先自动继续一次。实际上打开房间时就已经继续过了。
- 自动继续的那一轮花费与人按一样。它是看得见的房间轮次（不是后台静默调模型），可以停。
- 本步不做、留给后续：宿主启动时加载没人打开的房间（待定 7，M10）、guard 的 `initiatorMember`（M10）、把继续后那一轮的结果汇报给原派活人。最后一项人按「全部继续」时也没有做；原派活人已经从恢复那里收到了 `uncertain` 回报。
- room→lens 契约夹具不变：契约里那次运行没有重启，新字段都是可选的，在那里不出现。

## Testing

- `packages/room/tests/dispatch.host.spec.ts`，新块「restart: the room continues interrupted rounds itself (M9)」，8 例：
  - 开：并发和重复的活访问只发一次；派活带 `via`/`continues`；丢失的轮次在核心里也按没做完处理；排着的消息一并带上；起因是 `restart`。
  - 对房间 `getState` 会继续一次。
  - 关：不发。人按「全部继续」会记录 `continues`，并丢掉不是被打断轮次的 id。
  - 人已经继续过的轮次，房间不会再继续。
  - 自动继续出来的轮次再被打断，不再继续（`again`）。
  - guard 记录了这个成员时挡下（`self-restart`）。
  - guard 没有这个读法时不挡，只继续一次。
  - 成员输入队列暂停时挡下（`queue-paused`），房间暂停时也挡下（`room-paused`）。
- `packages/room/tests/restart-continue.client.spec.tsx` 覆盖：共用规则的筛选与护栏；横幅在开关关闭（无原因）、开着（待自动继续的不列）、已自动继续（可关掉、「设置」切换开关）、又被打断（带原因、另一位成员不受影响）时的样子；时间线行；成员页那一行。
- `packages/room/tests/room-composer.client.spec.tsx`：原有的「全部继续」用例在旧式行（无 run id）上照常通过。
- 截图（不提交）：`packages/room/tests/preview/restart.html?state=autocont|manual|again|setting`，1280 与 390、亮色与暗色，存于 `/tmp/m9-autocontinue/`。
- 未验证：3080 上带真实 CLI 成员的真实宿主重启。
