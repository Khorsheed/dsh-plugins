/** Questions sit inside the asker's round: recorded with its run and the text said so far, placed in the reply by that tail. */
import { describe, expect, it } from 'vitest'
import { askOffsets, roundTextSoFar } from '../src/dispatch.ts'

const q = (seq: number, data: Record<string, unknown>) => ({ type: 'room/question', seq, time: seq, data: { member: 'gm', memberId: 'm', questions: [], ...data } }) as never

describe('inline questions', () => {
  it('reads the current round\'s text from the member\'s session', () => {
    const events = [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '旧的一轮' }] } } },
      { type: 'turn/start', seq: 3, data: { turn: 2 } },
      { type: 'assistant/message', seq: 4, data: { message: { content: [{ type: 'reasoning', text: '想' }, { type: 'text', text: '我建议神灵各自承担一种仪式。' }] } } },
      { type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '第一批你想先刻画哪一组？' }] } } },
    ] as never
    expect(roundTextSoFar(events)).toBe('我建议神灵各自承担一种仪式。第一批你想先刻画哪一组？')
  })

  it('places each question after the text said before it; none said → 0; tail lost → -1', () => {
    const reply = '我建议神灵各自承担一种仪式。第一批你想先刻画哪一组？那就先深化阿努比斯。再定神庙：从前厅开始。'
    const events = [
      q(1, { id: 'a', runId: 'r', before: '我建议神灵各自承担一种仪式。第一批你想先刻画哪一组？' }),
      q(2, { id: 'b', runId: 'r', before: '那就先深化阿努比斯。再定神庙：' }),
      q(3, { id: 'other', runId: 'x', before: '无关' }),
    ]
    expect(askOffsets(events, 'r', reply)).toEqual([
      { id: 'a', at: reply.indexOf('那就') },
      { id: 'b', at: reply.indexOf('从前厅') },
    ])
    expect(askOffsets([q(1, { id: 'c', runId: 'r' })], 'r', reply)).toEqual([{ id: 'c', at: 0 }])
    expect(askOffsets([q(1, { id: 'd', runId: 'r', before: '这一段文字在最终回复里被改写掉了，找不到' })], 'r', reply)).toEqual([{ id: 'd', at: -1 }])
  })
})
