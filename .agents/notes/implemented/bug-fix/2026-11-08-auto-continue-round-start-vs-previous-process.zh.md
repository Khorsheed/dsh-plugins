# Agent Note: 自动继续看这一轮何时开始，而不看打断边何时写下

Status: implemented

## Problem

宿主重启后，房间会自己把这次重启打断的轮次各继续一次（[房间自动继续被重启打断的成员](../feature/2026-11-06-room-auto-continue-after-restart.zh.md)，M9）。2026-11-06 的热修把范围限定为**本次**重启打断的轮次，判断依据是房间日志何时写下这一轮的打断边：早于本进程房间服务启动时间（`RestartFacts.bootedAt`）写下的边，属于更早的重启。核心的启动候选（[重启发起者与启动时加载房间](../feature/2026-11-06-restart-initiator-and-startup-room-load.zh.md)，M10）用的是同一类事实：本进程亲手把某行从 `running` 转换过来，这一行才算本次重启的。

这两个事实记录的都是「什么时候被写下」，而不是「重启发生在什么时候」。打断边由第一个恢复这个房间的进程写下。如果打断这一轮的那次重启之后没有任何进程加载过这个房间，下一个加载它的进程会写下一条新的边，这一轮就被当成那个进程的重启打断的。M9 的说明把这一点列为已知遗留。`packages/room/tests/real-core.host.spec.ts` 里有两个测试在真实核心上复现了它，房间日志和成员账本都是合成的：

1. **核心转换了这一行，房间却没有恢复过。** 重启 1 打断了 ada 的一轮，当时房间的「重启后自动继续」是关的。启动加载冷读房间时载入了 ada 的账本，核心行变成 `uncertain`；房间本身没有加载，日志里仍写着 `running`。之后设置重新打开，重启 2 发生时没有任何东西在跑。进程 3 里有人打开房间，恢复此刻才写下 `uncertain` 边，时间不早于 `bootedAt`，于是房间自动继续了重启 1 打断的那一轮。只要进程 2 因为任何原因没有加载房间，结果都一样：有护栏挡着、这次重启是成员自己发起的、构建早于启动加载、进程在 5 秒延迟内就退出了。其中「重启由成员自己发起」最糟：那条护栏本来就是为了不让这一轮被继续。
2. **账本也没人载入过。** 进程 2 从没读过 ada 的账本，比如还没碰到它就退出了。进程 3 里账本文件仍写着 `running`，核心此刻转换它，并把房间列为启动候选。房间被加载，写下新的边，然后继续。

修复前这两个测试都失败（出现了 `auto-continue` 派活，核心也把房间列为候选）。

## Decision

- **一份持久的宿主进程记录**（`packages/local-agent/src/host-process.ts`，文件 `<homesRoot>/.host-process.json`）。核心启动时读这份记录。如果记录里的当前进程是别的进程，就轮换：那个进程变成 `previous`，本进程变成 `current`。一个进程由它的 pid 加启动时间（`performance.timeOrigin`）标识，所以同一进程里的插件重新载入不会改动记录。`LocalAgentRegistry.hostProcesses()` 返回 `{ current, previous? }`。
- **规则。** 开始时间早于上一个宿主进程启动的轮次，在上一个进程启动时就已经被打断了。不管它的打断写下得多晚，它都不属于最近这次重启。这里不涉及任何日期截止：比较的是这一轮自己的开始时间和上一个进程的启动时间。
- **房间**（`restart-continue.ts`）。`engine.view` 投影出 `RestartFacts.previousProcessStartedAt`（`previousHostProcessStart`，对 `hostProcesses` 的鸭子类型探测）。运行的 `startedAt` 早于它的轮次算 `stale`，与 M9 的打断边判断并列。陈旧轮次的处理不变：房间从不自己继续它们，它们留在人的「全部继续」横幅里，不附原因。因为用的是房间运行的开始时间，CLI 成员和房间自己的 agent 都适用。
- **核心**（`member-inbox.ts`）。`admittedAt`（没有时取 `createdAt`）早于上一个进程启动时间的 `running` 行，载入时仍转换成 `uncertain`，因为在对账之前它仍要挡住准入。但它不再算作本次启动打断的。因此 `interruptedMembers()` 的两条路径（未载入的文件、已转换的行）都不列出它，启动加载也不会为它去加载房间。
- **没有证据就什么都不变。** 有这份记录后的第一次启动（还没有 `previous`）、没有 local-agent 核心、或核心没有 `hostProcesses` 时，旧规则原样生效。

## Alternatives considered

- **给每个账本行盖上准入它的进程。** 否决。这能说明是哪个进程准入的，但那个进程是不是本进程的上一个，仍然需要一份进程先后的记录。房间自己的 agent 的轮次也没有账本行。
- **用 ankh-guard 的 `last-restart.json`。** 否决。只有经 guard 的重启才写它，普通的停止再启动或崩溃都不留记录。房间本来也把 guard 当作可选。
- **日期截止（忽略早于 N 小时的轮次）。** 否决。任务说明明确不要，而且两个方向都会错：进程 2 很短命时，最近的轮次会被判成陈旧；进程长时间运行时，旧轮次又会被判成新的。
- **把记录存在房间里。** 否决。房间没有自己的存储；核心本来就持有这个判断所关心的账本，也有可写的 homes 根目录。
- **每次核心插件启动都算一次启动。** 否决。进程运行中途核心重新载入一次，到下一次真正重启时，重新载入之前开始的轮次就都会被判成陈旧。用 pid 加进程启动时间做键，记录就是按进程的。

## Consequences

- 在上一个进程之前就开始的轮次，从不自动继续，也不会让房间成为启动候选。人在横幅里仍然看得到它，也仍然可以按「全部继续」。
- 上线后的第一次宿主启动还没有 `previous` 记录，旧规则会再生效一次；从第二次启动起新规则成立。
- 如果核心插件在进程中途重新载入时有成员轮次在跑，新核心载入时仍会转换这一行；只有当它开始于上一个进程之后，才算本次启动的。这和 M9 对同一情况的行为一致。
- 两个进程之间如果系统时钟跳变（NTP 校正），开始时间落在跳变区间里的轮次可能被误判。误判只会让一轮在「自动」和「横幅」之间换个位置，不会丢掉它。

## Testing

- `packages/room/tests/real-core.host.spec.ts`：上面两个复现（修复前都失败）。崩溃辅助函数现在还会通过改动 `performance.timeOrigin` 模拟「新的宿主进程」，原有的 M9/M10 真实核心用例在这种模拟下仍然通过。
- `packages/room/tests/restart-continue.client.spec.tsx`：开始早于 `previousProcessStartedAt` 的轮次，即使打断边是新的也算陈旧；没有这个事实时只按打断边判断。
- `packages/local-agent/tests/host-process.spec.ts`：轮换、重新载入保持记录、读不了的记录与写入失败、没有证据时的比较。
- `packages/local-agent/tests/member-inbox.spec.ts`：在上一个进程之前准入的 `running` 行，载入与否都不列出；同一行若开始于上一个进程之内，则列出。
- `packages/local-agent/tests/delegation-facade.spec.ts`：第一次启动时的 `hostProcesses()`。
