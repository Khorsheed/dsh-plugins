import { describe, expect, it } from 'vitest'
import { fromLogMessage, fromRequestMessage, serializeMessage, type CapturedMessage } from '../src/messages.ts'
import { reconstructSession, type SessionLogRow } from '../src/log-lane.ts'
import { recordAssembly } from '../src/segmenter.ts'
import { InspectorStore } from '../src/store.ts'

const PROMPT = 'You are an AI agent powered by DeepSeek Harness.\n\nYou are a writer.'

function message(id: string, text: string, role: CapturedMessage['role'] = 'user'): CapturedMessage {
  return { id, role, sourceKind: role === 'system' ? 'system-prompt' : role === 'assistant' ? 'model' : 'user', content: [{ type: 'text', text }] }
}

function assistant(seq: number, id = `answer-${seq}`): SessionLogRow {
  return {
    type: 'assistant/message', seq, time: seq, surfaceOp: 'append',
    data: { turn: 1, message: { ...message(id, 'answer', 'assistant'), source: { kind: 'model' } } },
  }
}

const rawImageUser = {
  id: 'images', role: 'user', source: { kind: 'user' },
  content: [
    { type: 'image', attachment: { name: 'shot.png' } },
    { type: 'file', attachment: { name: 'notes.md' } },
    { type: 'text', text: '检查' },
  ],
}

describe('capture-lane message parity', () => {
  it('keeps attachment labels when a log message is normalized', () => {
    const fromLog = fromLogMessage(rawImageUser)!
    const fromRequest = fromRequestMessage(rawImageUser as never)
    expect(serializeMessage(fromLog)).toBe('[image: shot.png]\n[file: notes.md]\n检查')
    expect(serializeMessage(fromLog)).toBe(serializeMessage(fromRequest))
    expect(fromLog).toEqual(fromRequest)
  })

  it('omits empty derived messages while keeping their surface nodes replaceable', () => {
    const system = (seq: number, id: string, text: string, surfaceOp: SessionLogRow['surfaceOp'] = 'append'): SessionLogRow => ({
      type: 'system/message', seq, time: seq, surfaceOp,
      data: { turn: 1, step: 1, message: { ...message(id, text, 'system'), source: { kind: 'system-prompt' } } },
    })
    const user = (seq: number): SessionLogRow => ({
      type: 'user/message', seq, time: seq, surfaceOp: 'append',
      data: { ...message(`user-${seq}`, 'next'), source: { kind: 'user' } },
    })
    const empty = system(4, 'empty', '', { op: 'replace', startSeq: 1, endSeq: 1 })
    empty.data = { turn: 1, step: 1, message: { id: 'empty', role: 'system', source: { kind: 'system-prompt' }, content: [] } }
    const [turn] = reconstructSession([
      system(0, 'head', PROMPT),
      system(1, 'later', 'later prompt'),
      user(2), assistant(3),
      empty, user(5), assistant(6),
      system(7, 'restored', 'restored prompt', { op: 'replace', startSeq: 4, endSeq: 4 }),
      user(8), assistant(9),
    ])
    expect(turn!.requests.map(request => request.segments.system.map(item => item.messageId))).toEqual([
      ['head', 'later'],
      ['head'],
      ['head', 'restored'],
    ])
  })

  it('reports only the real tail when a backfilled baseline meets the same live request', () => {
    const store = new InspectorStore()
    const head = message('head', PROMPT, 'system')
    const empty = { id: 'empty', role: 'system' as const, sourceKind: 'system-prompt', content: [] }
    store.insertLogTurns('s', reconstructSession([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'system/message', seq: 1, time: 1, surfaceOp: 'append', data: { turn: 1, step: 1, message: { ...head, source: { kind: 'system-prompt' } } } },
      { type: 'system/message', seq: 2, time: 2, surfaceOp: 'append', data: { turn: 1, step: 1, message: { ...empty, source: { kind: 'system-prompt' } } } },
      { type: 'user/message', seq: 3, time: 3, surfaceOp: 'append', data: rawImageUser },
      assistant(4),
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ]))

    store.turnStart('s', 2, 20)
    const [identity, persona] = PROMPT.split('\n\n')
    recordAssembly(store.assemblyRing, {
      sections: [{ name: 'identity', text: identity! }, { name: 'persona', text: persona! }],
      variables: {},
    }, 25)
    const previousAnswer = fromLogMessage((assistant(4).data as { message: unknown }).message)!
    const current = store.beginRequest({
      sessionId: 's', config: {},
      messages: [head, fromRequestMessage(rawImageUser as never), previousAnswer, message('next', 'next')],
    }, 30)!
    store.settleRequest(current, 31)
    const view = store.getRequest('s', current.seq)
    if (view === undefined || 'refused' in view) throw new Error('request missing')
    expect(view.segments.system.map(item => item.source)).toEqual(['identity', 'persona'])
    expect(view.prefix?.changed).toBeUndefined()
    expect(view.prefix?.changes).toEqual([])
    expect(view.prefix?.tail).toEqual({ count: 2, sources: ['model', 'user'] })
  })
})
