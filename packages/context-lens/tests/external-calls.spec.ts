/**
 * An external agent's log (claude-local, codex-local, kimi-cli, dsh-cli) is
 * a mirror written after each call: its steps open when a call is already
 * over, and one call may span several steps with the call's usage on the
 * last. A request starts when the log's previous event happened, and the
 * usage-less steps of a call join the step that carries its usage.
 */
import { describe, expect, it } from 'vitest'
import { reconstructSession, type SessionLogRow } from '../src/log-lane.ts'

const descriptor = (provider: string): SessionLogRow => ({ type: 'subagent/descriptor', seq: 0, time: 1, data: { version: 3, mode: 'one-shot', provider, label: 'x' } })
const call = (id: string, name: string) => ({ type: 'tool-call', id, name, arguments: '' })

function log(provider: string): SessionLogRow[] {
  return [
    descriptor(provider),
    { type: 'turn/start', seq: 2, time: 1000, data: { turn: 1 } },
    { type: 'user/message', seq: 3, time: 1000, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } },
    // Call A, mirrored at 8000 as two steps: Skill (no usage), ToolSearch (A's usage).
    { type: 'step/start', seq: 4, time: 8000, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 5, time: 8000, surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'm1', role: 'assistant', content: [call('t1', 'Skill')] } } },
    { type: 'tool/call', seq: 6, time: 8000, data: { turn: 1, step: 1, callId: 't1', name: 'Skill', arguments: '' } },
    { type: 'tool/result', seq: 7, time: 8001, surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'r1', role: 'tool', toolCallId: 't1', content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'step/end', seq: 8, time: 8001, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 9, time: 8002, data: { turn: 1, step: 2 } },
    { type: 'assistant/message', seq: 10, time: 8002, surfaceOp: 'append', data: { turn: 1, step: 2, message: { id: 'm2', role: 'assistant', content: [call('t2', 'ToolSearch')] }, usage: { inputTokens: 2, outputTokens: 242, cacheReadTokens: 0, cacheWriteTokens: 22711 } } },
    { type: 'tool/call', seq: 11, time: 8002, data: { turn: 1, step: 2, callId: 't2', name: 'ToolSearch', arguments: '' } },
    { type: 'tool/result', seq: 12, time: 9000, surfaceOp: 'append', data: { turn: 1, step: 2, message: { id: 'r2', role: 'tool', toolCallId: 't2', content: [{ type: 'text', text: 'x' }] } } },
    { type: 'step/end', seq: 13, time: 9000, data: { turn: 1, step: 2 } },
    // Call B, mirrored at 12000.
    { type: 'step/start', seq: 14, time: 12000, data: { turn: 1, step: 3 } },
    { type: 'assistant/message', seq: 15, time: 12000, surfaceOp: 'append', data: { turn: 1, step: 3, message: { id: 'm3', role: 'assistant', content: [{ type: 'text', text: 'done' }] }, usage: { inputTokens: 4, outputTokens: 109, cacheReadTokens: 22711 } } },
    { type: 'step/end', seq: 16, time: 12000, data: { turn: 1, step: 3 } },
    { type: 'turn/end', seq: 17, time: 12001, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

describe('external agent calls', () => {
  it('times each call from the previous event and joins a call\'s steps into one request', () => {
    const [turn] = reconstructSession(log('claude-local'))
    const requests = turn!.requests
    expect(requests.map(r => [r.requestNumber, r.startedAt, r.settledAt, r.usage?.outputTokens])).toEqual([
      [1, 1000, 8002, 242],
      [2, 9000, 12000, 109],
    ])
    expect(requests[0]!.responseSummary).toMatchObject({ kind: 'tool', name: 'Skill', more: 1 })
    expect(requests[0]!.response?.toolCalls.map(c => c.name)).toEqual(['Skill', 'ToolSearch'])
    expect(requests[0]!.execs.map(e => e.name)).toEqual(['Skill', 'ToolSearch'])
  })

  it('keeps an in-process subagent\'s steps as they are', () => {
    const [turn] = reconstructSession(log('spawn'))
    expect(turn!.requests.map(r => [r.startedAt, r.usage?.outputTokens])).toEqual([[8000, undefined], [8002, 242], [12000, 109]])
  })

  it('still shows a call that never got its usage step', () => {
    const rows = log('codex-local').filter(row => row.seq < 9 || row.seq === 17)
    const [turn] = reconstructSession(rows)
    expect(turn!.requests.map(r => r.responseSummary)).toEqual([expect.objectContaining({ kind: 'tool', name: 'Skill' })])
  })
})
