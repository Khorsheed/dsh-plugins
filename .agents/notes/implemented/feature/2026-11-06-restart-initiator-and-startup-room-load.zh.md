# Agent Note: 重启记下发起的成员，没人打开的房间也会继续

Status: implemented

## Problem

步骤 M9（[房间自动继续被重启打断的成员](2026-11-06-room-auto-continue-after-restart.zh.md)）留下两个缺口，都属于成员自开轮设计（`proposals/active/2026-11-06-member-self-started-rounds.md`，不在仓里，E 节）的步骤 M10。

- 房间不能自动继续「请求了这次重启」的那一轮。M9 探测 `selfRestartGuard.lastRestart()?.initiatorMember`，但没有哪个 guard 提供这个读取，所以每次重启都被当成「不是成员自己触发的」。
- 自动继续在房间被实时访问时才跑。重启后没人打开的房间永远不会继续。用户决定 7（2026-11-06）选择在宿主启动后主动加载这些房间。

## Decision

- **ankh-guard 记下成员**（`packages/ankh-guard`）。
  - `RestartRecord.initiatorMember?: string` 是成员的 dsh 子会话 id，从安排重启的那个进程的 `DSH_LOCAL_AGENT_MEMBER` 读取。local-agent 核心会在每个成员 CLI 进程上设置这个变量（[成员自部署防护](2026-11-06-member-self-deploy-guard.zh.md)）。guard 只按字符串引用它（`LOCAL_AGENT_MEMBER_ENV`、`initiatorMemberFromEnv`），不 import local-agent。
  - `schedule-exit` 把它写进重启标记，并以 `WD_INITIATOR_MEMBER` 传给退出代理，由退出代理写进 `last-restart.json`。
  - `restart` 动词的结果记录也带上它。组合回滚记录覆盖一条只有退出信息的记录时会继承它，和原来继承 `initiator` 一样。
  - 字段可选。旧记录照常读取，只是没有这一项。
- **读取方法**是 `SelfRestartGuard.lastRestart(): LastRestart | null`，其中 `LastRestart = Readonly<RestartRecord>`。
  - 它是同步方法，读 `last-restart.json`，不管报告是否已送达（`reportedAt`）。
  - 文件不存在或读不了时返回 null；记录没有 `exitAt` 时也返回 null（退出代理没找到监听者，说明根本没重启）。
  - `exitAt` 早于本进程启动超过 `resumeMaxSnapshotAgeMs`（默认 10 分钟）时同样返回 null。这样的记录属于更早的一次启动：普通的停止再启动不会写新记录覆盖它。
  - 形状与 M9 的探测完全一致，所以 `packages/room/src/dispatch.ts` 的 `restartInitiatorMember` 没有改动。
- **启动加载**（`packages/room/src/startup-load.ts`、`RoomService.loadInterruptedRooms`）。
  - 先由 local-agent 核心回答该看哪些房间。`MemberInbox.interruptedMembers()` 只列出被**启动本进程的那次重启**打断的成员：重启后还没被载入的账本文件，看是否有行仍写着 `running`；已经载入的账本，看是否有本进程在载入时亲手从 `running` 转成 `uncertain`、且尚未对账的行（按成员记录）。磁盘上本来就是 `uncertain` 的行是更早一次重启的遗留，一律不算；在上一个宿主进程启动之前就已准入的行也一样，不管它在磁盘上仍写着 `running` 还是此刻才被转换（[宿主进程记录](../bug-fix/2026-11-08-auto-continue-round-start-vs-previous-process.zh.md)）。生产上自动继续曾经恢复过几周前（10-23、10-26）被打断的轮次，所以启动加载绝不能因为陈旧轮次去加载房间。这次读取是只读的：不载入、不转换、不保存，读不了的文件和无关文件都跳过。
  - `LocalAgentRegistry.interruptedMemberParents()` 经 `memberBinding` 把这些成员映射到父会话 id。provider 还没登记的成员不列出。
  - 房间服务启动 5 秒后（`STARTUP_ROOM_LOAD_DELAY_MS`），房间取得这些父会话，像 `getState` 一样冷读每一个。只有当它是房间、并且 `autoContinueRounds(engine.view(...))` 不为空时才加载。这和实时访问用的是同一条规则，所以设置关闭、房间暂停、成员队列暂停、自己触发的重启、已经继续过的轮次，都会让房间保持不加载。
  - 加载就是 `ensureLive`，也就是打开房间时会发生的那次实时访问：先恢复，再跑 M9 的自动继续。
  - 同时最多加载 2 个房间（`STARTUP_ROOM_LOAD_CONCURRENCY`）。每个父会话只访问一次，失败记日志后跳过，插件卸载时停止。核心没有这个读取方法，或者没有被打断的成员时，什么也不做。除了自动继续那一轮本身（它是可见的），不调用模型。
- **「队列暂停」护栏指的是有打好的字在等**（`packages/room/src/core-ledger.ts` 的 `CoreLedgers.paused`）。核心在重启后载入账本时，只要账本里有 uncertain 行就会暂停它（`member-inbox.ts` 的 `load`）。M9 读的是这个裸标志，所以在真实核心上，每个被打断的成员都显示 `queue-paused`，房间从来不会继续任何人。M9 测试里的假核心不会暂停，掩盖了这一点；这里的真实核心用例把它暴露了出来。现在只有队列暂停**并且**有排队的 composer 行时，护栏才成立。暂停期间核心只扣住这类行，房间的行照常运行。原有的真实核心对账用例关掉了这个设置，因为它测的是手动对账。
- **没有主人的重启报告不交给房间**（`packages/ankh-guard/src/index.ts` 的 `deliver`）。没有 `initiator` 的记录原本由第一个创建的根 agent 认领。现在启动加载可能在没人看着的时候创建房间的 agent，那样会开一轮没人要的房间轮次。因此对没有主人的记录，房间会话（日志里有 `room/created`）跳过认领，改由下一个普通会话报告。`initiator` 就是这个房间的记录照常送到房间。

## Alternatives considered

- **在 guard 上加一个布尔 `selfTriggered()`。** 否决。M9 已经上线了 `lastRestart()` 探测，完整的记录在房间之外也有用。
- **`lastRestart()` 不管多旧都返回最后一条记录。** 否决。手动停止再启动之后，或者崩溃时保留了待报告的记录，一个旧的成员发起者会在之后每次启动都把那个成员挡下。时间窗与被打断会话快照的窗口相同。
- **房间自己遍历所有会话找房间。** 否决：每次启动都要扫一遍持久化。核心的账本目录里恰好就是相关的成员，每个账本条目都知道自己的父会话。
- **凡是有被打断成员的父会话都加载。** 否决。设置关闭的房间、或者轮次被护栏挡下的房间，每次启动都要白白恢复一次房间 agent。先用冷投影判断。
- **放在 local-agent 里做**，因为账本归核心管。否决：核心无法加载房间，也判断不了房间的设置和护栏。核心给名单，房间判断并加载。

## Consequences

- 重启后，有被打断成员的房间在宿主起来约 5 秒内就会继续，不需要有人打开它。规则和时间线上显示的行都与 M9 相同。
- 成员自己运行 `dsh-ankh-guard schedule-exit`（或 `restart`）时，那次重启之后它不会被自动继续。房间显示「这次重启是它这一轮发起的」，等人决定。部署脚本已经拒绝成员发起的重启（M7）；这一条覆盖成员直接调用 guard 的情况。
- 没有主人的崩溃恢复报告不会再被房间会话认领，包括人打开的房间。它会等下一个非房间会话。这是无人值守加载房间的代价。
- 启动加载不等 ankh-guard 的切换金丝雀，而是在固定延迟后运行。人在金丝雀期间打开房间也是同样的情况。

## Testing

- `packages/ankh-guard/tests/self-restart-guard.spec.ts`：
  - 在成员里运行 `schedule-exit`，标记里写入 `initiatorMember`。
  - `performExit` 把它写在 `initiator` 旁边；值为空时不写。
  - `initiatorMemberFromEnv` 覆盖有值、空白、缺失三种情况。
  - `restart` 动词的结果和组合回滚都保留这个字段。
  - `lastRestart()`：已报告的记录照常返回；没有该字段的旧记录照常返回；更早一次启动的记录返回 null；只有错误的记录返回 null；读不了的文件返回 null。
  - 没有主人的记录跳过房间 agent，交给下一个普通会话；`initiator` 是房间的记录仍然送到房间。
- `packages/local-agent/tests/member-inbox.spec.ts`：`interruptedMembers` 在崩溃前后都不改动文件（逐字节相同）；本次启动转换的行只列一次；对账后不再列出；跳过损坏文件和无关文件；没有目录时返回空。更早一次重启的遗留行，不管从磁盘读还是已载入，都不列出。
- `packages/local-agent/tests/delegation-facade.spec.ts`：`interruptedMemberParents` 为磁盘上仍是 `running` 的账本列出去重后的父会话；陈旧的 `uncertain`、已结束的成员和未知成员都不列出。
- `packages/room/tests/real-core.host.spec.ts`：在真实核心上，崩溃后投递变成 uncertain、账本被暂停。`interruptedMemberParents` 列出这个房间，启动加载把它载入，房间只继续一次。之后的访问不再继续，核心里那一行已取消。
- `packages/room/tests/real-core.host.spec.ts`：唯一被打断的轮次是更早一次重启的遗留时，启动时不加载房间。重启 1 发生时设置是关的；之后设置重新打开；重启 2 发生时没有任何东西在运行。核心一个房间也不列出，什么也不加载、不继续。
- `packages/room/tests/dispatch.host.spec.ts`：M9 的 `queue-paused` 用例改为排在一条 composer 排队行之后。
- `packages/room/tests/dispatch.host.spec.ts`，「rooms nobody opens are loaded once at host start (M10)」一组：
  - 经核心找到房间并只加载一次；重复项和不存在的会话跳过；房间只继续一次，第二遍什么也不加载。
  - 设置关闭或房间暂停：不加载。
  - guard 记下的发起者正是该成员：不加载。
  - 没有被打断的成员、核心没有这个读取方法、或者读取抛错：什么也不做。
  - `loadEach` 每个候选只访问一次，同时最多 2 个，报告失败，卸载时停止。
