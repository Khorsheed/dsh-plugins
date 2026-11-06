# Agent Note: Kimi 发消息前等它自己开的一轮

Status: implemented

## Problem

成员空闲时 Kimi 后台任务完成，Kimi 会自己开一轮：wire 写一行 `turn.prompt`，`origin.kind: 'task'`（旧版叫 `background_task`），没有 `promptId`，之后是这一轮的各步和 `turn.ended`。房间在这一轮进行中发 `session/prompt`，派的活看起来「瞬间完成、没有回复」，真正的回复稍后在没人看的情况下跑掉。

已安装的 kimi 2.4.1 二进制在这种情况下的行为（只读，读的是二进制里打包的源码字符串）：

- ACP 服务端的 `assertNoActiveTurn` 只检查 ACP 自己正在处理的请求（`this.driver`）。Kimi 自己开的轮没有 ACP driver，检查直接通过。只有 ACP 驱动的一轮进行中又来第二个 ACP prompt，才会报 `turn.agent_busy`。
- `agent.prompt()` 于是进到 v2 引擎，引擎把它按先进先出排在正在跑的轮后面（SDK facade 的注释：「v1 drops a prompt submitted while a turn is active … v2 queues it FIFO」）。launch 解析为 `undefined`，ACP 的 `driveLaunch` 立刻以 `stopReason: 'end_turn'` 结束这次请求，没有 chunk，也不报错。
- 自开轮结束后，排队的 prompt 作为单独一轮运行：wire 上先是一行 origin 为 user、带这条消息原文的 `turn.prompt`，然后是各步和 `turn.ended`。ACP 不转发这一轮的任何事件，因为 `driverFor(turnId)` 会丢掉当前 ACP 请求那一轮以外的一切。
- 没有 ACP driver 时 `session/cancel` 什么也不做，所以 ACP 取消不了排队的那一轮。

以上只从二进制读出，没有在真实会话上复现，因为复现要花模型钱。

## Decision

Kimi live 驱动（`packages/local-agent-kimi/src/live-driver.ts`）在每次发消息前后读成员的 `wire.jsonl`。只读的纯函数放在 `packages/local-agent-kimi/src/self-turn.ts`。

- **发之前先等。** 发 `session/prompt` 前，`findOpenSelfTurn` 检查 wire 里最后一个 `turn.prompt` 是否后面没有 `turn.ended`、而且 origin 不是 user。第一次检查同步读 wire，所以前面没有自开轮的消息仍和以前一样，在同一个 tick 里发出。有自开轮时，驱动每 500 ms 读一次 wire，等这一轮结束，最多等 10 分钟。这时这一轮 dsh 回合已经开了，所以房间显示成员忙。等待期间自开轮的内容边写边镜像；等待中取消的话，消息不会发出。时间戳早于当前进程启动时间（`KimiLiveRuntime.spawnedAt`）的自开 `turn.prompt` 是已死进程留下的，不算。
- **撞车后跟着读，不重发。** 自开轮仍可能在检查和发出之间开起来，等待也可能到上限。所以 `end_turn` 没有回复时，`readQueuedPrompt` 从发送前读到的行数开始读 wire。这行之后第一个 origin 为 user 的 `turn.prompt` 就是我们发的。发出时有自开轮在跑，或者它前面先出现了自开 `turn.prompt`，就算排队了。这时驱动继续跟读 wire，直到那一轮的 `turn.ended`。回复取自那一轮的文本 `content.part`，每个模型步一段，用 `textSegmentSeparator` 拼接；结束原因照映射（`completed` → completed，`cancelled` → aborted，其余 → error）。跟读期间驱动占着该成员的 turn chain，下一条消息不会插进来。
- **其余不变。** 我们的消息直接开了自己的一轮、前面没有自开轮，或者 2 秒宽限内 wire 上什么都没出现，就沿用原来的保护：`end_turn` 没有回复按错误处理，绝不当成空的成功。
- **跟读中途放弃。** 跟读在排队那一轮结束前因为取消或失败中止时，Kimi 仍在跑那一轮，ACP 停不了它。`KimiLiveRuntime.queuedTurnAbandoned` 让下一条消息等任何没结束的轮（包括 origin 为 user 的），不只是自开轮。

时长可以通过 `KimiLiveDriverTimeouts` 覆盖（`selfTurnWaitMs`、`selfTurnPollMs`、`collisionGraceMs`）。自开轮本身的内容仍按 11-01 的规则并入下一轮 dsh 回合；让它成为独立执行，是「成员自己开的一轮」设计后面的步骤。

## Alternatives considered

**自开轮结束后重发。** 没选：引擎已经把这条消息排进去了，重发会让同一件事跑两遍。

**把瞬间返回的 `end_turn` 当错误，让房间重试。** 没选：排队那一轮照样会跑、照样在没人看的情况下回复，重试同样会跑两遍。

**等任何没结束的轮，不只等自开轮。** 默认不这样做。旧 wire 和很多测试夹具里，user 的 `turn.prompt` 后面没有 `turn.ended`，也没有时间戳；而 ACP 驱动的轮在 turn chain 放下一条消息之前就已经结束了。只在跟读中途放弃之后才放宽，因为只有这时能确定还有一个 user 轮在跑。

**用 `fs.watch` 代替轮询。** 这里没做。持续观察由设计里的观察器（B②）负责。这两处等待很少发生，而且有上限，500 ms 读一次文件就够了。

## Consequences

- 后台任务轮进行中派来的房间任务，现在会等，并拿到真正的回复，不再看起来做完了却是空的。
- 自开轮很长时，消息最多压 10 分钟才发出；超时后发出并跟读。
- 跟读中本地取消只结束 dsh 这一轮，Kimi 排队的那一轮继续跑，因为 ACP 管不到它。它的内容并入下一轮。
- 没撞车但也没有回复的一轮，结算最多晚 2 秒（这段宽限是留给 wire 落盘慢时显出撞车的）。

## Testing

- `packages/local-agent-kimi/tests/self-turn.spec.ts` 测纯函数：没结束的自开轮、旧版 origin、按启动时间判定为残留、半行、direct、unknown、queued、running、ended 各阶段，以及结束原因映射。
- `packages/local-agent-kimi/tests/live-driver.spec.ts` 的「turns kimi opens on its own」用 FakeAcp 加合成 wire 测：消息等自开轮结束再发；等待中取消就不发；自开轮超过上限时先发出再跟读；撞车时拿到排队那一轮的回复、只发一次、记一条警告；排队那一轮失败时按错误结算；没有自开轮（以及只有残留的自开轮）时立刻发出，`end_turn` 没有回复仍是错误。
