// @vitest-environment jsdom
/**
 * The receipt line under a human message (room-timeline-interaction-order
 * B1): the delivery replay feeding it, its Definition, and each delivery
 * state's line. Fixtures are synthetic (the event shapes of a real queue, no
 * real content).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { replayDeliveries } from '../src/deliveries.ts'
import { ANSWERED_QUESTION_TEXT, WITHDRAWN_TEXT } from '../src/delivery-notes.ts'
import { receiptParts, roomReceiptDefinition } from '../src/client/receipt.ts'
import { RoomReceiptView, type RoomReceiptViewProps } from '../src/client/RoomReceiptView.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { RoomDelivery, RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const T0 = 1_700_000_000_000

function ev(type: string, seq: number, data: unknown, time = T0 + seq): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}
const human = (seq: number, id: string, time: number) => ev('user/message', seq, { id, source: { kind: 'user' }, content: [{ type: 'text', text: '…' }] }, time)
const dispatch = (seq: number, messageId: string | undefined, time: number, targets: readonly string[] = ['m-gu'], extra: object = {}) =>
  ev('room/dispatch', seq, { targets: targets.map(id => id.slice(2)), targetIds: targets, text: '…', origin: 'human', ...messageId === undefined ? {} : { messageId }, ...extra }, time)
const edge = (seq: number, dispatchSeq: number, state: string, time: number, extra: object = {}, memberId = 'm-gu') =>
  ev('room/delivery-state', seq, { id: `${dispatchSeq}:${memberId}`, dispatchSeq, memberId, state, ...extra }, time)

const ROSTER: RoomState = {
  members: [
    { id: 'm-gu', name: '故事顾问', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-gu' as SessionId },
    { id: 'm-hb', name: '画布维护', kind: 'cli', provider: 'codex', invitedBy: 'human', childSessionId: 'child-hb' as SessionId },
  ],
  relays: [], tasks: [], runs: [],
}

function stateOf(events: readonly SessionEvent[], extra: Partial<RoomState> = {}): RoomState {
  return { ...ROSTER, deliveries: replayDeliveries(events), ...extra }
}

/**
 * The queue's shape: the first message is taken in at once, the second
 * lands 569 s later while the round runs, and is taken in 79 s after that
 * when the first round's reply lands.
 */
const first = [human(1, 'msg-1', T0), dispatch(2, 'msg-1', T0), edge(3, 2, 'running', T0 + 200)]
const second = [human(4, 'msg-2', T0 + 569_000), dispatch(5, 'msg-2', T0 + 569_000)]
const settled = [edge(6, 2, 'done', T0 + 648_000), edge(7, 5, 'running', T0 + 648_000)]

function line(state: RoomState, seq: number, locale: Record<string, string> = zh, extra: Partial<RoomReceiptViewProps> = {}): HTMLElement | null {
  const roomStore = { subscribe: () => () => {}, getCached: () => state, refresh: async () => {} }
  const props = { node: { data: { seq, time: 0, messageId: 'm' } }, sessionId: 'room-1', roomStore, t: makeTranslate(locale), ...extra } as unknown as RoomReceiptViewProps
  const { container } = render(<RoomReceiptView {...props} />)
  return container.querySelector<HTMLElement>('[data-room-receipt]')
}

describe('the human message deliveries', () => {
  it('know their message and whether its bubble sits above the dispatch', () => {
    const rows = replayDeliveries([...first, ...second])
    expect(rows.map(row => [row.id, row.messageId, row.bubble])).toEqual([['2:m-gu', 'msg-1', 'before'], ['5:m-gu', 'msg-2', 'before']])
  })

  it('a message the room\'s own agent writes when it takes it in is not in the log yet, then sits after its dispatch', () => {
    const waiting = replayDeliveries([dispatch(1, 'msg-d', T0)])
    expect(waiting[0]!.bubble).toBeUndefined()
    const taken = replayDeliveries([dispatch(1, 'msg-d', T0), edge(2, 1, 'running', T0 + 50), human(3, 'msg-d', T0 + 60)])
    expect(taken[0]!.bubble).toBe('after')
  })

  it('keep the settling edge\'s words', () => {
    const rows = replayDeliveries([...first, edge(4, 2, 'done', T0 + 9, { text: ANSWERED_QUESTION_TEXT })])
    expect(rows[0]!.note).toBe(ANSWERED_QUESTION_TEXT)
  })
})

describe('the receipt Definition', () => {
  it('claims the human\'s dispatch that names its message, nothing else', () => {
    expect(roomReceiptDefinition.match(dispatch(5, 'msg-2', T0))).toEqual({ id: '5', role: 'start' })
    expect(roomReceiptDefinition.match(dispatch(5, undefined, T0))).toBeNull()
    expect(roomReceiptDefinition.match(dispatch(5, 'msg-2', T0, ['m-gu'], { origin: 'member', from: 'm-hb' }))).toBeNull()
    expect(roomReceiptDefinition.match(dispatch(5, 'msg-2', T0, ['m-gu'], { via: 'auto-continue' }))).toBeNull()
    expect(roomReceiptDefinition.match(ev('room/dispatch', 5, { targets: ['x'], text: '…', origin: 'human', messageId: 'msg-2' }))).toBeNull()
    expect(roomReceiptDefinition.match(human(4, 'msg-2', T0))).toBeNull()
  })
})

describe('the receipt line', () => {
  it('replays the queue: 排队中 while the round runs, 排队 1 分 19 秒后送达 once taken in; the first message says nothing', () => {
    expect(line(stateOf([...first, ...second]), 5)?.textContent).toContain('排队中 · 等 故事顾问 做完这一轮')
    cleanup()
    const after = stateOf([...first, ...second, ...settled])
    expect(line(after, 5)?.textContent).toBe('排队 1 分 19 秒后送达')
    cleanup()
    expect(line(after, 2)).toBeNull()
    expect(receiptParts(after, 2)).toBeUndefined()
  })

  it('reads each delivery state', () => {
    const one = (row: Partial<RoomDelivery>, extra: Partial<RoomState> = {}) => {
      cleanup()
      const state = { ...ROSTER, ...extra, deliveries: [{ id: '5:m-gu', dispatchSeq: 5, memberId: 'm-gu', origin: 'human', status: 'queued', text: '…', queuedAt: T0, bubble: 'before', ...row } as RoomDelivery] }
      return line(state, 5)?.textContent ?? null
    }
    expect(one({ status: 'queued' }, { restartFacts: { queuePaused: ['m-gu'] } })).toContain('⏸ 已暂停 · 故事顾问 的队列暂停中')
    expect(one({ status: 'held' })).toContain('暂存')
    expect(one({ status: 'done', note: ANSWERED_QUESTION_TEXT })).toBe('↩ 当作回答交给了 故事顾问 这一轮')
    expect(one({ status: 'cancelled', note: WITHDRAWN_TEXT })).toBe('已撤回 · 没有送到 故事顾问')
    expect(one({ status: 'cancelled', note: '已并入下一条消息一起送达' })).toBe('已并入下一条消息一起送达')
    expect(one({ status: 'failed', error: 'boom' })).toBe('没送达：boom')
    // A round a restart cut off says so on its own card only: the message reached its member.
    expect(one({ status: 'cancelled', endedBy: 'restart', note: '被重启打断' })).toBeNull()
    expect(one({ status: 'uncertain' })).toBeNull()
    expect(one({ status: 'cancelled', note: '你发了新消息；被重启打断的这一轮按没做完处理' })).toBeNull()
    expect(one({ status: 'done', startedAt: T0 + 2_000 })).toBeNull()
    // No bubble above the dispatch (the direct path): the queue above the composer carries it.
    expect(one({ status: 'queued', bubble: undefined })).toBeNull()
  })

  it('writes several recipients on one line and offers a withdraw only for the one still queued', () => {
    const events = [human(1, 'msg-1', T0), dispatch(2, 'msg-1', T0, ['m-hb', 'm-gu']), edge(3, 2, 'running', T0 + 100, {}, 'm-hb')]
    const receipt = line(stateOf(events), 2, zh, { withdraw: async () => undefined })
    expect(receipt?.textContent).toContain('画布维护 已收到')
    expect(receipt?.textContent).toContain('故事顾问 排队中')
    const buttons = [...receipt!.querySelectorAll('button')].map(button => button.textContent)
    expect(buttons).toEqual(['撤回给故事顾问的'])
  })

  it('撤回 takes back the queued delivery and shows why it failed', async () => {
    const withdraw = vi.fn(async () => '已经送到，撤不回了')
    const receipt = line(stateOf([...first, ...second]), 5, zh, { withdraw })
    fireEvent.click(receipt!.querySelector('button')!)
    expect(withdraw).toHaveBeenCalledWith(5, 'm-gu')
    await waitFor(() => expect(receipt!.querySelector('[role="alert"]')?.textContent).toBe('已经送到，撤不回了'))
  })

  it('reads in English', () => {
    expect(line(stateOf([...first, ...second, ...settled]), 5, en)?.textContent).toBe('Delivered after queuing 1m 19s')
  })

  it('a legacy dispatch without recipients ids has no line', () => {
    const events = [human(1, 'msg-1', T0), ev('room/dispatch', 2, { targets: ['故事顾问'], text: '…', origin: 'human', messageId: 'msg-1' })]
    expect(receiptParts(stateOf(events), 2)).toBeUndefined()
  })
})
