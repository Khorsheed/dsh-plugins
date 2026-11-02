# Agent Note：room、local-agent 与 Context Lens 的契约各收成一份

Status: implemented

## Problem

room、local-agent 核心和 Context Lens 跨包交换事件与服务，每一侧各写各的那一半，已经走样：

- 核心声明了 `RoomMemberMessageGate`；room 按形状实现，却没写 `implements`，自带的消息类型里 `provenance` 是可选、值为 JSON，而核心发的是必填的 `Record<string, string>`。
- room 读成员会话的 `local-agent/compaction` 事件时，强转成 room 自己的形状，没有用核心的 `LocalAgentCompactionEvent`。
- 终态 `room/run-state` 的 `childTurn` 在结算时取子会话**最后一个** `turn/start`，所以本轮还没开始就失败的 run 会认领上一个 run 的轮次，Context Lens 再把那一轮的请求同时记到两个轮次下。
- `/compact` 识别有三份（核心、room 派发、lens store），room 的 journal 和输入框里还各有内联副本。
- room 的 `/compact` 结果在整个成员日志上 `findLast('local-agent/compaction')`：不写压缩记录的 provider（Claude Code、DSH）会显示更早一次压缩的数字，或者显示「已压缩」却没有数字。
- Context Lens 对 run id 做 `Number(head)`，id 为纯 UUID 的 run（room 给没有入日志派发的投递用的 id，即确认后的转达）和没有 id 的 run（旧日志）都被静默丢掉。

这份契约更早的修复（room 写 `messageId`、lens 读 `cancelled` 和改名）见[批 0 的 Note](../bug-fix/2026-11-02-room-lens-contract-and-family-hazards.zh.md)。

## Decision

**消息闸门就是核心的接口。** `RoomService extends TypertRemoteService implements RoomMemberMessageGate`。room 的 `RoomMemberMessage`、`RoomMemberMessageReceipt` 是核心 `LocalAgentMemberMessage`、`RoomMemberMessageReceipt` 的别名。`provenance` 采用核心的必填 `Record<string, string>`：唯一的调用方（`member-channel.ts` 的 `handToGate`）总是以字符串发送发送方的委派视图，room 也按 `provenance.provider` 认发送方，可选或 JSON 值的 provenance 描述的是一种不存在的调用。room 保留对畸形调用的运行时检查；`room/relay` 事件里的 provenance 仍按 JSON 存（转达还可能来自别的路径）。

**压缩事实用核心的类型。** `RoomMemberCompactedEvent` 的事实字段是 `LocalAgentCompactionEvent` 的索引类型，`recordCompaction` 借核心对 `SessionEventMap` 的扩充收窄子会话事件。这不新增依赖边：room 本来就导入核心的类型（`check:plugins` 仍为 0）。

**一个 run 拥有子会话日志里的一段区间。** running 的 `room/run-state` 边记录 `childFromSeq`：准入时子会话的下一个 seq；成员会话还不存在时记 0。`packages/room/src/dispatch.ts` 的 `runChildEvents(roomEvents, runId, child)` 返回从这个 seq 起的子会话事件。准入时子会话未加载，就返回 run 的 `startedAt` 之后写入的事件。没有 running 边（从未准入）的 run 什么都不拥有；没有 id 的旧 run 读整个日志。所有终态写入点都从这段区间取 `childTurn`：结算、取消、停止任务、继续前进、对账、计划对账。取到的是区间内最后一个 `turn/start`，没有就不写。

**`/compact` 识别只有一份，在核心。** `COMPACT_COMMAND` 和 `isCompactCommand` 放在核心无依赖的 `types.ts`，从 `./types` 和包根导出。room 不能在运行时调用它们：room 把核心当可选 peer、只做类型导入，值导入会让没装 local-agent 家族时 room 加载失败。lens 则完全没有依赖。所以两边各保留一份具名镜像（`packages/room/src/journal.ts`、`packages/context-lens/src/room.ts`）。原来所有内联判断都改走镜像：room 的派发判断、上次游标跳过、输入框路由，以及 lens 的轮次过滤。两份镜像由下面的契约测试钉在核心上。

**`/compact` 只报告本 run 的结果。** `recordCompaction` 读本 run 区间内最后一条 `local-agent/compaction`。完成的一轮如果一条都没写，这一行就带 `unreported: true` 入日志。界面显示「已执行压缩命令 · 该成员不报告压缩数据」（en："ran /compact · this member does not report compaction data"），投递的结果文字也这么写。目前 Claude Code 和 DSH 成员走这个状态。没有让 Claude 的 provider 写压缩事件：它把 `/compact` 当普通提示词透传，从不解析 CLI 的压缩报告，这次改动也没法在真实 CLI 上验证那份报告。

**lens 收下 room 写的每个 run。** `<dispatchSeq>:<memberId>` 形式的 id 保留它的派发。纯 UUID 按原 id 收下，不带派发 seq。没有 id 的记成 `legacy:<member>:<startedAt>`。三种情况下成员 id 都按成员当前的名字解析。没有派发 seq 的 run 不成轮次，但会给同一成员更早的未结束 run 划定边界，自己的子轮次也不让别人认领。

## Testing

- `packages/room/tests/lens-contract.host.spec.ts` 在确定性时钟上跑 room 的真实写入路径（带首个任务的邀请、人发消息、改名、被停止的 run、确认的转达、`/compact`），并规整 UUID。然后把 room 日志和入库的 `packages/context-lens/tests/fixtures/room-contract.json` 对比，room 写出的东西一变就失败。`UPDATE_ROOM_CONTRACT=1 pnpm --filter @khorsheed/dsh-room test` 重新生成夹具。这组测试还把 room 的 `/compact` 镜像钉在核心上。
- `packages/context-lens/tests/room-contract.spec.ts` 用 lens 自己的解析器重放这份夹具，检查：
  - 每条人类派发成为一个轮次，锚在它的 `messageId` 上；
  - `/compact` 和转达投递都不成轮次；
  - 被停止的 run 显示已取消，用 room 写的开始时间和耗时；
  - 按当前名字发的改名进入名册；
  - UUID run 归到它的成员名下；
  - 压缩 run 不认领子轮次；
  - lens 的 `/compact` 镜像对夹具表里每个用例的判断都与核心一致。
- room：本轮开始前就失败的 run 不写 `childTurn`，下一个 run 认领自己的轮次。`/compact` 忽略更早的压缩并把这一轮标为不报告。压缩行在中英文下都显示不报告状态。lens：UUID run 给卡住的 run 划定时间窗边界；旧 run 被收下。

## Alternatives considered

**room 从核心值导入 `isCompactCommand`。** 否决：room 把核心声明为可选 peer，宿主端是普通 `tsc` 产物，导入会留到运行时。没装 local-agent 家族时 room 会加载失败，违反 `check:plugins` 白名单批准这条边的前提——声明并降级（「只做类型导入、可选 peer」）。

**room 在运行时问 facade（`localAgent.isCompactCommand`）。** 否决：room 的 journal 重放（`previousCursor`）和输入框是纯函数，拿不到 context 去探测。一半调用点仍得留本地副本，这样会多出一份运行时契约，镜像却一份也去不掉。

**lens 对 room 加 devDependency，测试里直接导入 room 的写入路径。** 否决：为了测试方便在包图里加一条 lens → room 的边，而方案要求 lens 零依赖。由 room 自己的测试生成夹具，覆盖面相同，陈旧检查也能保证它可信。

**只用时间划区间（`event.time >= startedAt`）。** 不作为主规则：同一毫秒写入的两条事件可能落在边界错误的一侧。时间规则只在准入时子会话未加载、room 无从知道 seq 时兜底。

**让 Claude Code provider 写 `local-agent/compaction`。** 推迟，不是否决。如果 CLI 报告压缩前后的 token 数，这是更好的答案；但这个 provider 目前把 `/compact` 当普通提示词，它的报告格式也没有在真实 CLI 上验证过。在那之前，「不报告」状态是诚实的。DSH provider（冻结的 `local-agent-dsh-headless` live 路径）情况相同。

**把「是否外部 CLI」写进 room 事件给 lens 用（`member.kind` 对 lens 的 `IN_PROCESS_PROVIDERS`）。** 没做：两者回答的是不同的问题。lens 按宿主 `subagent/*` 的 provider 给任何子会话分类，不论是否在房间里。room 的 `kind` 是名册数据，lens 已经从 `room/member-added` 收到。要统一它们需要宿主一侧的事实，而不是 room 一侧的。

## Consequences

- 闸门的消息或回执、压缩事件的事实字段一改，room 现在会编译失败，而不是悄悄走样。
- Context Lens 不再把上一轮记到一个本轮开始前就失败的 run 下，转达投递也会给更早的未结束 run 划定边界。
- room 的行为变化：对 provider 不报告压缩的成员（Claude Code、DSH）发 `/compact`，现在显示「该成员不报告压缩数据」而不是「已压缩」，也不再借用更早一次压缩的数字。
- 主 agent 的行为变化：插进 agent 进行中轮次的回报不会写新的 `turn/start`，所以这种 run 不再记录 `childTurn`；以前它认领自己插入的那一轮。
- 代价：三份 `/compact` 镜像仍以代码形式存在。它们不会悄悄走样，因为夹具的期望值由核心自己的函数决定。room 的写入路径每次变化都要重新生成夹具，包括多一次 `Date.now()` 这类附带变化，因为时钟按调用次数计。
