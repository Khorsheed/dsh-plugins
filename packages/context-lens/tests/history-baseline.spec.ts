import { describe, expect, it } from 'vitest'
import { InspectorStore } from '../src/store.ts'
import { reconstructSession } from '../src/log-lane.ts'
import type { CapturedMessage } from '../src/messages.ts'

const message = (id: string, text: string): CapturedMessage => ({ id, role: 'user', sourceKind: 'user', content: [{ type: 'text', text }] })
const old = message('old', 'original user request')
const next = message('next', 'next turn request')
const tools = [{ name: 'read', description: '', parameters: {} }]
const snapshot = (messages: CapturedMessage[], sessionId = 's') => ({ sessionId, config: {}, messages, tools })

describe('history baseline across turn boundaries', () => {
  it('retains prior input when the next live turn changes system prompt and tools', () => {
    const store = new InspectorStore()
    const system = { ...message('system', 'long prompt'), role: 'system' as const }
    store.turnStart('s', 1, 0)
    store.beginRequest(snapshot([system, old]), 10)
    store.turnEnd('s', 1, { kind: 'completed' }, 20)
    // Neither another agent nor a summarization call is the main history baseline.
    store.turnStart('other', 1, 21)
    store.beginRequest(snapshot([next], 'other'), 22)
    store.beginRequest({ ...snapshot([next]), purpose: 'compaction' }, 23)
    store.turnStart('s', 2, 30)
    const request = store.beginRequest({ ...snapshot([{ ...system, content: [{ type: 'text', text: 'short prompt' }] }, old, next]), tools: [...tools, { name: 'write', description: '', parameters: {} }] }, 40)!
    expect(request.segments.history.map(x => x.messageId)).toEqual(['old'])
    expect(request.segments.added.map(x => x.messageId)).toEqual(['next'])
    expect(request.segments.system[0]?.freshness).toBe('new')
    expect(request.segments.tools.map(x => x.added)).toEqual([false, true])
  })

  it('repairs an already captured request when earlier logs arrive later, without changing its input', () => {
    const store = new InspectorStore()
    store.turnStart('s', 2, 30)
    const request = store.beginRequest(snapshot([old, next]), 40)!
    expect(store.getRequest('s', request.seq)?.segments.added).toHaveLength(2)
    const originalChars = request.totalChars
    store.insertLogTurns('s', reconstructSession([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'request/header', seq: 1, time: 1, data: { header: { tools } } },
      { type: 'user/message', seq: 2, time: 2, surfaceOp: 'append', data: { ...old, source: { kind: 'user' } } },
      { type: 'assistant/message', seq: 3, time: 10, surfaceOp: 'append', data: { message: { ...message('answer', 'response'), role: 'assistant' } } },
      { type: 'turn/end', seq: 4, time: 20, data: { turn: 1, reason: { kind: 'completed' } } },
    ]))
    const detail = store.getRequest('s', request.seq)!
    expect(detail.segments.history.map(x => x.messageId)).toEqual(['old'])
    expect(detail.segments.added.map(x => x.messageId)).toEqual(['next'])
    expect(detail.segments.tools[0]?.added).toBe(false)
    expect(request.totalChars).toBe(originalChars)
    expect([...detail.segments.history, ...detail.segments.added].map(x => x.full)).toEqual(['original user request', 'next turn request'])
  })
})
