# Agent Note: 人发的消息，送达状态显示在消息上

Status: implemented

## Problem

CLI 成员正忙时人又发一条消息，房间把它画成一个普通气泡，和已送达的没有区别；输入框上方却把它重复两次（预览行和核心账本的「协作间派活」行），哪一处都没说它还没送到。@ 一个不是协调者的 CLI 成员时，排队一处标记都没有。成员之间的消息早就从房间投递读出「排队中」，人发的消息没有。房间时间线设计 B 线（`proposals/active/2026-11-08-room-timeline-interaction-order.md`，不在仓库里）第 B1 步。

## Decision

- **唯一来源**：房间投递（`room/dispatch` + `room/delivery-state` 回放）。`replayDeliveries` 现在给每条投递多投影三项：所属的人类消息（`messageId`）、这条消息在日志里的位置（`bubble: 'before' | 'after'`，缺省 = 还不在日志里）、结算边自己的话（`note`）。三项都只是 `RoomDelivery` 上的投影字段，没有新增事件类型或事件字段。
- **独立节点**：`room-receipt`（`src/client/receipt.ts`、`RoomReceiptView.tsx`）认领带消息 id 的人类 `room/dispatch`（以前没有 Definition 认领它），在气泡下面画一行右对齐小字。单个收件人：排队中 · 等 X 做完这一轮 / ⏸ 已暂停 / ⚠ 等核对（+ 去核对，打开成员会话）/ 暂存 / 排队 N 后送达 / ↩ 当作回答交给了 X 这一轮 / 已撤回 · 没有送到 X / 取消时自带的原话 / 没送达：原因 / 结果待核对。多个收件人写成一行（「画布维护 已收到 · 故事顾问 排队中」）。
- **默认安静**：10 秒内（`QUEUE_SHOWN_MS`）被收到的消息什么都不显示；排过队的留一行小字「排队 1 分 19 秒后送达」。所以旧日志里投递都已结束，只有值得知道的地方才出现一行。
- **上面没有气泡就没有回执**：消息不在 dispatch 之前的投递（原生协调者的直接路径，宿主收到时才写气泡）不画回执——它归输入框上方的队列（C1 步）。
- **顺序**：`postMessage` 把 `room/run-moved` 挪到人类 dispatch 之后（原来在之前），运行卡片浮到气泡和回执下面，不再夹在两者之间。
- `ANSWERED_QUESTION_TEXT` 挪到纯常量模块 `src/delivery-notes.ts`（`dispatch.ts` 转出），客户端才能认出它。

## Alternatives considered

- **回执锚在 `user/message` 上**：否决（T0 ①）。宿主对同 anchor 的节点按 `${kind.length}:${kind}${id}` 做 `localeCompare`；官方气泡 kind 是 `input-message`，`room-receipt` 会排到它上面，除非故意挑 kind 长度去赢——太脆。认领 `user/message` 还会给所有会话的每条人类消息建节点，原生轮次里的还会被归进轮次过程。
- **把状态放进官方气泡里**：做不到——`conversation.chat.user.before` 不带消息 id。可以作为上游请求，不依赖它。
- **撤回后把官方气泡变淡**：气泡的 DOM 上没有消息 id 可找；改由回执写「已撤回」。
- **每条消息都显示「已送达」**：用户否决（设计待定 2）：马上送达是常态，每个气泡都加一行是噪音。

## Consequences

- 房间给消息归任务时，可见的「归入任务」一行仍夹在气泡和回执之间；两行都读作这条消息的注脚。
- 回执读已缓存的房间状态（不新增轮询），随房间 store 刷新而更新。
- 本 note 之前就有的取消原因（并入下一条一起送达、被后续消息取代）在两种语言里都原样显示中文。

## Testing

`tests/receipt.client.spec.tsx` 回放一段按事故形状合成的队列（第一条马上收到，第二条排队 79 秒 →「排队 1 分 19 秒后送达」）、每个投递状态的那一行、多收件人的一行、英文、Definition 的认领范围和旧日志无回执。`tests/dispatch.host.spec.ts` 钉住 `room/run-moved` 在人类 dispatch 之后。
