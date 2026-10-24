/**
 * An external agent's session (a local CLI member opened on its own): its
 * turns open live, but its requests reach only the log. A live turn that
 * ended with nothing captured takes the log's turn on the next read, even
 * after the backfill completed; a turn that really made no request is
 * compared once and left alone.
 */
import { describe, expect, it } from 'vitest'
import { reconstructSession, type SessionLogRow } from '../src/log-lane.ts'
import { InspectorStore } from '../src/store.ts'

const turn = (n: number, at: number, withRequest: boolean): SessionLogRow[] => [
  { type: 'turn/start', seq: at, time: at, data: { turn: n } },
  ...n === 1 ? [{ type: 'request/header', seq: at + 1, time: at + 1, data: { header: { config: { provider: 'claude-local', model: 'opus' }, tools: [] } } }] : [],
  { type: 'user/message', seq: at + 2, time: at + 2, surfaceOp: 'append', data: { id: `u${n}`, role: 'user', content: [{ type: 'text', text: `q${n}` }], source: { kind: 'user' } } },
  ...withRequest ? [
    { type: 'step/start', seq: at + 3, time: at + 3, data: { turn: n, step: 1 } },
    { type: 'assistant/message', seq: at + 4, time: at + 4, surfaceOp: 'append', data: { turn: n, step: 1, message: { id: `a${n}`, role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, usage: { inputTokens: 10, outputTokens: 2 } } },
    { type: 'step/end', seq: at + 5, time: at + 5, data: { turn: n, step: 1 } },
  ] : [],
  { type: 'turn/end', seq: at + 6, time: at + 6, data: { turn: n, reason: { kind: 'completed' } } },
] as SessionLogRow[]

describe('external agent live turns', () => {
  it('fills a live turn that captured nothing from the log, after the backfill completed', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(turn(1, 100, true)))
    expect(store.backfillState('s')).toBe('complete')
    store.turnStart('s', 2, 200, 200)
    expect(store.needsLogTurns('s')).toBe(false) // still running
    store.turnEnd('s', 2, { kind: 'completed' }, 206)
    expect(store.needsLogTurns('s')).toBe(true)
    store.insertLogTurns('s', reconstructSession([...turn(1, 100, true), ...turn(2, 200, true)]))
    expect(store.getTurn('s', 2)!.scopes.find(scope => scope.kind === 'main')?.requests).toHaveLength(1)
    expect(store.listTurns('s').turns.map(t => t.hostTurn)).toEqual([1, 2])
    expect(store.listTurns('s').turns[1]?.startSeq).toBe(200)
    expect(store.needsLogTurns('s')).toBe(false)
  })

  it('compares a turn that made no request once', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(turn(1, 100, true)))
    store.turnStart('s', 2, 200)
    store.turnEnd('s', 2, { kind: 'completed' }, 206)
    store.insertLogTurns('s', reconstructSession([...turn(1, 100, true), ...turn(2, 200, false)]))
    expect(store.needsLogTurns('s')).toBe(false)
  })
})
