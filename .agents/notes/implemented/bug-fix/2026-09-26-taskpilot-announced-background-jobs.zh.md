# Agent Note: TaskPilot's Background jobs capsule lists only the jobs the tool announced

Status: implemented

## Problem

胶囊「后台任务」镜像的是 job controller 的按会话花名册，而这份花名册把两类长得完全一样的行混在一起。`tool-bash` 把**每一次**调用都注册成 job——「a foreground call is a job the tool waits on, so the command is visible and killable from the moment it starts」——并在前台调用 settle 的那一刻删掉它的记录（前台等待里的 `registry.remove`）；而后台 job 的记录在 settle 之后会保留到 owner agent 生命周期结束。线缆上没有任何东西能区分两者：`JobSpec` 与 `JobView` 只有 `kind: 'bash'`、label、owner 和生命周期字段，整条链路上都不存在 background 标记。

胶囊把这件事的两半都继承了下来。前台行在命令运行期间出现、随命令结束消失，而胶囊的显隐判据是 `jobs.length > 0`，于是整枚胶囊会随命令结束一起闪没；至于在 job controller 那条 100ms 花名册合并窗口内跑完的命令，它被注册又被删除，任何一帧都读不到它，因而从头到尾没出现过。暴露这个问题的会话（小红书爬虫梦境研究建议，`session-190d5c52`）里 9 次 `bash` 全是前台——胶囊只可能闪，而快的那几条根本不可见。

子 agent 的 `bash` job 是第三种、独立的情况，不在本决策范围内：`registry.list(caller)` 以 owner 为围栏，子会话的 job 属于子会话的花名册，永远不会进父会话的胶囊。

## Decision

只有当会话日志把它宣告为后台 job 时，胶囊才渲染这条 `bash` 行。`./src/client/announced-jobs.ts` 把一页历史折叠成三个事实：

- **ids** —— `started background job <id>` **仅在**配对 `tool/call` 带 `run_in_background: true` 时才计入（因此一条仅仅打印了这句话的前台命令无法给 job 背书）；`moved to background job <id>`（前台调用超时后获得的提升）即使没有配对也计入——假阳性只会多显示一行本会被隐藏的行。
- **since** —— 该页覆盖到的最早事件时间。
- **ambiguousSince** —— 该页中最早那条 ack 不可读的后台调用。

一条行被隐藏，当且仅当它是 `bash` 行、`startedAt` 不早于 `since`、其 id 不在 `ids` 中，且（若存在 `ambiguousSince`）`startedAt` 早于它。其余一律渲染：非 `bash` 类型永远不会被隐藏（没有生产者会删除它们），早于该页的行永远不会，缺少 window 时（无历史通道、读取失败、空页）什么都不隐藏——因此每一条不可读路径都退化为该过滤器存在之前的行为。

这次读取用的就是详情页已经在用的那条 capability-probed 历史通道（`remote.session.follow`/`page`），所以本 bundle 没有新增任何 RPC 面。它在会话挂载时、任何行到达之前就武装好（这正是让前台命令连第一帧都进不去的原因），并在出现新的未宣告 id 时重复读取，最多持续 `BASH_ANNOUNCE_GRACE_MS`；超过之后该行就是前台记录，判定为终局。同一 id 集合内的状态跳动不触发任何读取。

退场路径：这个模块只是「一个注入读取 + 一个 prop」。一旦宿主给 job 加上 background 标记（`JobSpec`/`JobView`），或者干脆不再注册前台调用，这个过滤器就退化成读那个字段，日志读取随之消失。

## Alternatives considered

**等宿主加字段，或者请宿主不要再注册前台调用。** 这是根因修法，也正是把过滤器收敛到一个注入读取背后的原因。只把它当作*第一步*被否决，因为它需要上游改动：插件侧这套判定恰好就是字段落地后要退场的那段代码，而它现在就能发。

**只显示被观察到进入终态的行。** 不需要任何新管线，而且在一个方向上精确——前台记录在 settle 时被删除，所以一条已 settle 的花名册行必然是后台或提升出来的 job。被否决：它会让一条正在运行的后台 job 在整个运行期间不可见，而那恰恰是胶囊存在的唯一时刻。

**改从 `SessionBinding.eventSource` 读这个事实，而不是走历史 RPC。** 客户端 session binding 确实暴露了事件窗口，但它的契约把它保留给 Conversation assembly；插件直接读它就是越界。被否决，改用详情页已经在驱动的 RPC。

**客户端做一次「见过的行就粘住」的缓存。** 能消除闪烁，但仍把前台行留在胶囊里，而且无法找回那些从未进入任何一帧的命令。被否决：这是把缺陷藏起来，而不是判定它。

## Consequences

赚到：只要模型还有后台工作在跑，胶囊就在；它列出的每一行都是模型知道的 job（有 id、能 `job_output`/`job_kill`、有详情页）；停止按钮再也不可能中止一条模型只是在等待的命令；`run_in_background` 调用立即可见（它的 ack 与 job 注册在同一步落盘），被提升的那种则在超时时刻出现——而那正是它变成后台 job 的时刻。

代价：前台命令运行期间在胶囊里不可见——它在会话自己的工具卡片里仍然可见；被提升的 job 在超时前不可见；dock 在每次会话打开、以及每出现一个新的未宣告 `bash` id 时读取一页有界的会话日志；提升的证据只有一句 ack，因此一次把它弄丢的分页会让那一行隐藏到下一次读取；而一次成功读取之后的读取失败会保留上一次判定，这个问题会在下一次 `bash` 调用时自愈。

顺带发现、本次刻意不修：详情页的执行轨迹折叠（`job-trajectory.ts`）通过 `message.content[0].toolCallId` 配对结果，那是 0.1.5 之前的形状。当前宿主把 call id 放在 `message.toolCallId` 与 `message.source.callId` 上，因此该折叠在真实日志上返回空——已用 `session-70b25dac` 自己的工具行验证，而本次改动的解析器能正确读出它们。修它是一次独立的、用户可见的改动，该有它自己的决策。

## Testing

`tests/announced-jobs.spec.ts` 钉住折叠（当前与 legacy 两种线缆形状、不可伪造的后台 ack、无配对的提升、歧义、畸形行、空页）、判定（隐藏/保留/非 `bash`/早于该页/fail-open/歧义）、刷新键，以及 loader 永不 reject 的契约。`tests/taskpilot-dock.spec.tsx` 补上挂载层用例：前台行被隐藏且胶囊随之离场、被宣告的行保留停止动词、日志不可读时每行都显示、非 `bash` job 与被隐藏的 `bash` 行共存、迟到的 ack 会在重试时揭示出来、以及重试在宽限期到点后停止。解析器另外用 `session-70b25dac` 的真实工具行做过校验，恰好找出该会话启动的那两个后台 job。

## Related

- [TaskPilot's job detail tab is a page-type right-sidebar tab](../architecture/2026-09-10-taskpilot-sidebar-tab.md) —— 本次过滤器复用其历史通道的那个 tab。
- [Host 0.1.7-rc.1 adaptation](../architecture/2026-09-24-host-017-rc1-adaptation.md) —— 被过滤的行所来自的那条双通道花名册读取。
- [TaskPilot trajectory rows carry the issued command line](../feature/2026-08-21-taskpilot-trajectory-command-lines.md) —— Consequences 中点名的、仍在期待 legacy 线缆形状的那次折叠。
