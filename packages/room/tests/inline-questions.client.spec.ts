/** A reply splits around the questions its round asked; a question placed in a round has no row of its own. */
import { describe, expect, it } from 'vitest'
import { replyParts } from '../src/client/RoomSpeechView.tsx'
import { roomQuestionDefinition } from '../src/client/nodes.ts'

const ask = (id: string) => ({ id, member: 'gm', questions: [{ id: 'x', question: '哪一组？' }], state: 'answered' as const, answers: [{ id: 'x', selected: ['A'] }], time: 1, runId: 'r' })

describe('reply parts', () => {
  it('interleaves text and questions in order; an unfound split opens the reply, marked mid-round', () => {
    const data = { seq: 1, time: 1, member: 'gm', text: '前半段。后半段。', asks: [{ id: 'a', at: 4 }] }
    expect(replyParts(data, [ask('a')]).map(part => part.kind === 'text' ? part.text : `[${part.ask.id}${part.mid ? ' mid' : ''}]`))
      .toEqual(['前半段。', '[a]', '后半段。'])
    expect(replyParts({ ...data, asks: [{ id: 'a', at: -1 }] }, [ask('a')]).map(part => part.kind === 'text' ? part.text : `[${part.ask.id}${part.mid ? ' mid' : ''}]`))
      .toEqual(['[a mid]', '前半段。后半段。'])
    // Unknown to the log (an older cache): plain text.
    expect(replyParts(data, []).map(part => part.kind)).toEqual(['text'])
  })

  it('hides the row of a question placed in a round; an unplaced one keeps its row', () => {
    const start = (data: Record<string, unknown>) => roomQuestionDefinition.start({} as never, { event: { type: 'room/question', seq: 3, time: 3, data: { id: 'q', member: 'gm', memberId: 'm', questions: [], ...data } }, role: 'start' } as never, undefined as never)
    expect(roomQuestionDefinition.buildViewNode!({ key: 'k', id: 'q', state: start({ runId: 'r' }) } as never)).toMatchObject({ visibility: 'hidden' })
    expect(roomQuestionDefinition.buildViewNode!({ key: 'k', id: 'q', state: start({}) } as never)).toMatchObject({ visibility: 'visible' })
  })
})
