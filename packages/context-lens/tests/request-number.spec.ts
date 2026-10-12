import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InspectorStore } from '../src/store.ts'
import { foldLogRows, openCursor, reconstructSession, type SessionLogRow } from '../src/log-lane.ts'

const rows = JSON.parse(readFileSync(new URL('./fixtures/main-session.json', import.meta.url), 'utf8')) as SessionLogRow[]
const childRows = JSON.parse(readFileSync(new URL('./fixtures/child-session.json', import.meta.url), 'utf8')) as SessionLogRow[]
const history = () => reconstructSession(structuredClone(rows))
function request(store: InspectorStore, sessionId: string, at: number) {
  const r = store.beginRequest({ sessionId, config: {}, messages: [], tools: [] }, at)!
  store.settleRequest(r, at + 1)
  return r
}
const numbers = (store: InspectorStore, id: string, turn: number) =>
  store.getTurn(id, turn)?.scopes.find(s => s.kind === 'main')?.requests.map(r => r.requestNumber)

describe('agent-local request numbers', () => {
  it('numbers complete logs chronologically before newest-first retention, and keeps query IDs separate', () => {
    const turns = history()
    const all = turns.flatMap(t => t.requests)
    expect(all.map(r => r.requestNumber)).toEqual(all.map((_, i) => i + 1))
    const store = new InspectorStore({ maxTurnsPerSession: 2 })
    store.insertLogTurns('s', turns)
    expect(store.listTurns('s').turns.map(t => t.turnSeq)).toEqual([3, 4])
    expect(numbers(store, 's', 3)).toEqual(turns[2]!.requests.map(r => r.requestNumber))
    expect(numbers(store, 's', 4)).toEqual(turns[3]!.requests.map(r => r.requestNumber))
    const first = store.getTurn('s', 4)!.scopes[0]!.requests[0]!
    expect(first.seq).toBe(0) // query IDs still follow insertion, never UI numbering
    expect(first.requestNumber).toBeGreaterThan(1)
    store.insertLogTurns('s', turns)
    expect(store.getRequest('s', first.seq)?.requestNumber).toBe(first.requestNumber)
    store.turnStart('s', 5, Date.now())
    expect(request(store, 's', Date.now()).requestNumber).toBe(all.length + 1)
  })

  it('counts main, children and other sessions independently and survives turn eviction', () => {
    const store = new InspectorStore({ maxTurnsPerSession: 1 })
    store.turnStart('s', 1, 100)
    expect(request(store, 's', 110).requestNumber).toBe(1)
    store.subagentCatalog('s', 'child', 'child', 120)
    store.turnStart('child', 1, 121)
    expect(request(store, 'child', 130).requestNumber).toBe(1)
    expect(request(store, 's', 140).requestNumber).toBe(2)
    store.turnEnd('s', 1, { kind: 'completed' }, 150)
    store.turnStart('other', 1, 160)
    expect(request(store, 'other', 170).requestNumber).toBe(1)
    store.turnStart('s', 2, 180)
    expect(request(store, 's', 190).requestNumber).toBe(3)
    expect(store.getTurn('s', 1)).toBeUndefined()
    expect(numbers(store, 's', 2)).toEqual([3])
  })

  it('anchors an observed live turn from the full log without changing its query ID', () => {
    const store = new InspectorStore()
    const turns = history()
    store.turnStart('s', 4, turns[3]!.startedAt)
    const live = request(store, 's', turns[3]!.startedAt + 1)
    expect(live.requestNumber).toBeUndefined()
    expect(store.needsRequestNumbers('s')).toBe(true)
    store.insertLogTurns('s', turns.slice(0, 3))
    expect(live.requestNumber).toBeUndefined()
    // Initial backfill was complete before this live turn's response was durable.
    store.insertLogTurns('s', turns)
    expect(store.getRequest('s', live.seq)?.requestNumber).toBe(turns[3]!.requests[0]!.requestNumber)
    expect(store.needsRequestNumbers('s')).toBe(false)
    expect(request(store, 's', turns[3]!.startedAt + 2).requestNumber).toBe(turns.flatMap(t => t.requests).length + 1)
  })

  it('does not invent #1 for a partial log or a turn observed after it started', () => {
    const partial = rows.slice(rows.findIndex(r => r.type === 'turn/start' && (r.data as { turn?: number })?.turn === 3))
    expect(reconstructSession(partial).flatMap(t => t.requests).every(r => r.requestNumber === undefined)).toBe(true)
    const store = new InspectorStore()
    const live = request(store, 's', 100)
    store.turnEnd('s', 3, { kind: 'completed' }, 110)
    store.insertLogTurns('s', history())
    expect(store.getRequest('s', live.seq)?.requestNumber).toBeUndefined()
  })

  it('keeps child log numbering across incremental reads and includes failed attempts', () => {
    const cursor = openCursor()
    const cut = childRows.findIndex(r => r.type === 'assistant/message') + 1
    const first = foldLogRows(cursor, childRows.slice(0, cut))
    const later = foldLogRows(cursor, childRows.slice(cut))
    expect(first.map(r => r.requestNumber)).toEqual([1])
    expect(later.map(r => r.requestNumber)).toEqual([2, 3])
    expect(later[1]?.status).toBe('failed')
    expect(foldLogRows(cursor, [])).toEqual([])
  })
})
