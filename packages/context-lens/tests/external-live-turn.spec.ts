/**
 * An external agent's session opened on its own (a CLI in its own process):
 * no request passes through this host, so its turns come from its log only.
 * Live turns opened before it was known to be external give way to the log's;
 * live events mark it for a re-read; each read rebuilds the turns the log has
 * grown or closed since, and the log's unclosed last turn reads as running.
 */
import { describe, expect, it } from 'vitest'
import { reconstructSession, type SessionLogRow } from '../src/log-lane.ts'
import { InspectorStore } from '../src/store.ts'

const step = (n: number, at: number, k: number): SessionLogRow[] => [
  { type: 'step/start', seq: at, time: at, data: { turn: n, step: k } },
  { type: 'assistant/message', seq: at + 1, time: at + 1, surfaceOp: 'append', data: { turn: n, step: k, message: { id: `a${n}-${k}`, role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, usage: { inputTokens: 10, outputTokens: 2 } } },
  { type: 'step/end', seq: at + 2, time: at + 2, data: { turn: n, step: k } },
] as SessionLogRow[]
const open = (n: number, at: number): SessionLogRow[] => [
  ...n === 1 ? [
    { type: 'subagent/descriptor', seq: at - 2, time: at - 2, data: { version: 3, mode: 'one-shot', provider: 'claude-local', label: 'Claude Code' } },
    { type: 'request/header', seq: at - 1, time: at - 1, data: { header: { config: { provider: 'claude-local', model: 'opus' }, tools: [] } } },
  ] : [],
  { type: 'turn/start', seq: at, time: at, data: { turn: n } },
  { type: 'user/message', seq: at + 1, time: at + 1, surfaceOp: 'append', data: { id: `u${n}`, role: 'user', content: [{ type: 'text', text: `q${n}` }], source: { kind: 'user' } } },
] as SessionLogRow[]
const close = (n: number, at: number): SessionLogRow => ({ type: 'turn/end', seq: at, time: at, data: { turn: n, reason: { kind: 'completed' } } })

const main = (store: InspectorStore, turn: number) => store.getTurn('s', turn)!.scopes.find(scope => scope.kind === 'main')!

describe('log-driven external agent sessions', () => {
  it('replaces the empty live turns, then follows the log as it grows', () => {
    const store = new InspectorStore()
    // Live events arrived before the panel first read the session.
    store.turnStart('s', 1, 100, 100)
    store.turnEnd('s', 1, { kind: 'completed' }, 190)
    store.turnStart('s', 2, 200, 200)
    const log1 = [...open(1, 100), ...step(1, 110, 1), close(1, 190), ...open(2, 200), ...step(2, 210, 1)]
    store.markLogDriven('s')
    store.insertLogTurns('s', reconstructSession(log1))
    expect(store.listTurns('s').turns.map(t => t.hostTurn)).toEqual([1, 2])
    expect(main(store, 1)).toMatchObject({ status: 'ok' })
    expect(main(store, 2)).toMatchObject({ status: 'running' })
    expect(main(store, 2).requests).toHaveLength(1)
    expect(store.needsLogRead('s')).toBe(false)

    // A live event marks a re-read; the running turn grows, then closes.
    store.turnEnd('s', 2, { kind: 'completed' }, 290)
    expect(store.needsLogRead('s')).toBe(true)
    store.insertLogTurns('s', reconstructSession([...log1, ...step(2, 220, 2), close(2, 290)]))
    expect(main(store, 2)).toMatchObject({ status: 'ok' })
    expect(main(store, 2).requests).toHaveLength(2)
    expect(store.listTurns('s').turns[1]?.startSeq).toBe(200)

    // A new turn appears on the next read.
    store.turnStart('s', 3, 300, 300)
    store.insertLogTurns('s', reconstructSession([...log1, ...step(2, 220, 2), close(2, 290), ...open(3, 300), ...step(3, 310, 1)]))
    expect(store.listTurns('s').turns.map(t => t.hostTurn)).toEqual([1, 2, 3])
    expect(main(store, 3).requests).toHaveLength(1)
  })

  it('follows the log of a member session also known as a room child', () => {
    const store = new InspectorStore()
    store.subagentCatalog('room', 's', 'Claude Code', 50)
    expect(store.isChild('s')).toBe(true)
    const log1 = [...open(1, 100), ...step(1, 110, 1), close(1, 190)]
    store.markLogDriven('s')
    store.insertLogTurns('s', reconstructSession(log1))
    store.noteLogActivity('s')
    expect(store.needsLogRead('s')).toBe(true)
    store.insertLogTurns('s', reconstructSession([...log1, ...open(2, 200), ...step(2, 210, 1)]))
    expect(store.listTurns('s').turns.map(t => t.hostTurn)).toEqual([1, 2])
  })

  it('leaves an in-process session to the live capture', () => {
    const store = new InspectorStore()
    store.turnStart('s', 1, 100)
    store.noteLogActivity('s')
    expect(store.needsLogRead('s')).toBe(false)
    expect(store.listTurns('s').turns.map(t => t.hostTurn)).toEqual([1])
  })
})
