# Agent Note: A human message's delivery state reads on the message

Status: implemented

## Problem

When a CLI member was busy and the human sent it another message, the room showed the message as an ordinary bubble — identical to a delivered one — while the queue above the composer repeated it twice (a preview row and the core ledger's 「协作间派活」 row) without ever saying it had not arrived. A message @-addressed to a non-coordinator CLI member showed no queue mark anywhere. Member-to-member messages already carried 排队中 from the room's deliveries; the human's did not. Room timeline design B line (`proposals/active/2026-11-08-room-timeline-interaction-order.md`, outside the repo), step B1.

## Decision

- **One source**: the room's deliveries (`room/dispatch` + `room/delivery-state` replay). `replayDeliveries` now also projects, per delivery, the human message it belongs to (`messageId`), where that message sits in the log (`bubble: 'before' | 'after'`, absent = not in the log yet) and the settling edge's own words (`note`). All three are projection-only fields on `RoomDelivery`; no event type or event field was added.
- **A node of its own**: `room-receipt` (`src/client/receipt.ts`, `RoomReceiptView.tsx`) claims the human `room/dispatch` that names its message (no Definition claimed those before) and renders one right-aligned small line under the bubble. Single recipient: 排队中 · 等 X 做完这一轮 / ⏸ 已暂停 / ⚠ 等核对 (+ 去核对, opening the member's session) / 暂存 / 排队 N 后送达 / ↩ 当作回答交给了 X 这一轮 / 已撤回 · 没有送到 X / the cancellation's own words / 没送达：reason / 结果待核对. Several recipients join on one line (「画布维护 已收到 · 故事顾问 排队中」).
- **Quiet by default**: a message taken in within 10 s (`QUEUE_SHOWN_MS`) shows nothing; one that waited keeps a single quiet 「排队 1 分 19 秒后送达」. So old logs, whose deliveries have all settled, show a line only where something worth knowing happened.
- **No line without a bubble above**: a delivery whose message is not before its dispatch (the native coordinator's direct path, written by the host when it takes the message in) gets no receipt — it belongs to the queue above the composer (step C1).
- **Order**: `postMessage` writes `room/run-moved` after the human dispatch (it was before), so running cards float below the bubble and its receipt, never between them.
- `ANSWERED_QUESTION_TEXT` moved to a pure `src/delivery-notes.ts` (re-exported from `dispatch.ts`) so the client can recognize it.

## Alternatives considered

- **Anchor the receipt on the `user/message`**: rejected (T0 ①). The host breaks equal-anchor ties by `localeCompare` on `${kind.length}:${kind}${id}`; the official bubble's kind is `input-message`, so a `room-receipt` would sort above it unless its kind's length were chosen to win — fragile. Claiming `user/message` also creates a node for every human message in every session, and inside native turns those join the turn process.
- **Put the state inside the official bubble**: not possible — `conversation.chat.user.before` carries no message id. An upstream ask, not a dependency.
- **Dim the official bubble of a withdrawn message**: the bubble's DOM carries no message id to find it by; the receipt says 已撤回 instead.
- **Show 已送达 on every message**: rejected by the user (design pending item 2): instant delivery is the norm and would add noise to every bubble.

## Consequences

- The visible 「归入任务」 decision row still sits between a bubble and its receipt when the room files the message; both read as the message's footnotes.
- The receipt reads the cached room state (no new polling); it updates when the room store refreshes.
- Cancellation reasons that predate this note (并入下一条一起送达, 被后续消息取代) are shown verbatim in Chinese in both locales.

## Testing

`tests/receipt.client.spec.tsx` replays a synthetic queue shaped like the incident (first message taken in at once, second queued 79 s → 「排队 1 分 19 秒后送达」), each delivery state's line, the multi-recipient line, the English line, the Definition's claim set and the legacy no-line case. `tests/dispatch.host.spec.ts` pins `room/run-moved` after the human dispatch.
