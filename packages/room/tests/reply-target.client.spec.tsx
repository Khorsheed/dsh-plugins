// @vitest-environment jsdom
/**
 * 「↑ 回复的是 21:56 那条」 (room-timeline-interaction-order B4): which
 * message a reply answers when a later message to the same member waited
 * behind its round. Synthetic fixtures in the shape of the incident.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, render } from '@testing-library/react'
import { replayDeliveries } from '../src/deliveries.ts'
import { ANSWERED_QUESTION_TEXT } from '../src/delivery-notes.ts'
import { replyTarget } from '../src/client/reply-target.ts'
import { RoomSpeechView } from '../src/client/RoomSpeechView.tsx'
import { formatClock } from '../src/client/format.ts'
import { zh } from '../src/client/locales.ts'
import type { RoomSpeechViewProps } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const T0 = 1_700_000_000_000
const ev = (type: string, seq: number, data: unknown, time: number) => ({ type, seq, time, data }) as SessionEvent
const human = (seq: number, id: string, time: number) => ev('user/message', seq, { id, source: { kind: 'user' }, content: [] }, time)
const dispatch = (seq: number, id: string, time: number) => ev('room/dispatch', seq, { targets: ['故事顾问'], targetIds: ['m-gu'], text: '…', origin: 'human', messageId: id }, time)
const edge = (seq: number, dispatchSeq: number, state: string, time: number, extra: object = {}) => ev('room/delivery-state', seq, { id: `${dispatchSeq}:m-gu`, dispatchSeq, memberId: 'm-gu', state, ...extra }, time)

const ROSTER = { members: [{ id: 'm-gu', name: '故事顾问', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-gu' as SessionId }], relays: [], tasks: [], runs: [] } as RoomState
const REPLY_AT = T0 + 648_000
// First message taken in at once; the second sent 569 s later while that round ran, taken in when its reply lands.
const queue = [
  human(1, 'msg-1', T0), dispatch(2, 'msg-1', T0), edge(3, 2, 'running', T0 + 200),
  human(4, 'msg-2', T0 + 569_000), dispatch(5, 'msg-2', T0 + 569_000),
]
const stateOf = (events: readonly SessionEvent[]): RoomState => ({ ...ROSTER, deliveries: replayDeliveries(events) })

describe('replyTarget', () => {
  it('a reply whose member had a later message waiting names the message it answers', () => {
    const state = stateOf([...queue, edge(6, 2, 'done', REPLY_AT), edge(7, 5, 'running', REPLY_AT)])
    expect(replyTarget('2:m-gu', REPLY_AT, state)).toEqual({ answeredAt: T0, laterAt: T0 + 569_000, target: '[data-room-receipt="5"]' })
    // The second message's own reply has nothing waiting behind it.
    expect(replyTarget('5:m-gu', REPLY_AT + 300_000, state)).toBeUndefined()
  })

  it('no later message, a message sent after the reply, or one the round took as an answer: no line', () => {
    expect(replyTarget('2:m-gu', REPLY_AT, stateOf(queue.slice(0, 3)))).toBeUndefined()
    expect(replyTarget('2:m-gu', T0 + 500_000, stateOf(queue))).toBeUndefined()
    expect(replyTarget('2:m-gu', REPLY_AT, stateOf([...queue, edge(6, 5, 'done', T0 + 569_100, { text: ANSWERED_QUESTION_TEXT })]))).toBeUndefined()
  })

  it('the reply card opens with the line', () => {
    const state = stateOf([...queue, edge(6, 2, 'done', REPLY_AT), edge(7, 5, 'running', REPLY_AT)])
    const roomStore = { subscribe: () => () => {}, getCached: () => state, refresh: async () => {} }
    const props = {
      node: { data: { seq: 8, time: REPLY_AT, member: '故事顾问', text: '新大纲', runId: '2:m-gu' } },
      sessionId: 'room-1', roomStore, openSession: () => {}, renderSlot: () => null, t: makeTranslate(zh),
    } as unknown as RoomSpeechViewProps
    const { container } = render(<RoomSpeechView {...props} />)
    expect(container.querySelector('[data-room-reply-to]')?.textContent).toContain(`↑ 回复的是 ${formatClock(T0)} 那条 · 你 ${formatClock(T0 + 569_000)} 那条刚开始处理`)
  })
})
