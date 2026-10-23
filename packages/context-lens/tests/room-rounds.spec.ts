/**
 * Room rounds: once another member coordinates, a human's message to the room
 * runs no main turn — it dispatches member runs into their child sessions.
 * Each such dispatch is a round of its own, numbered with the main turns by
 * time, holding exactly the runs it started; the map marks the handoff.
 */
import { describe, expect, it } from 'vitest'
import { reconstructSession, type BuiltLogRequest, type SessionLogRow } from '../src/log-lane.ts'
import { InspectorStore } from '../src/store.ts'

const turn1: SessionLogRow[] = [
  { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
  { type: 'request/header', seq: 1, time: 100, data: { header: { config: { provider: 'deepseek', model: 'flash' }, tools: [] } } },
  { type: 'user/message', seq: 2, time: 200, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: '邀请 Kimi' }], source: { kind: 'user' } } },
  { type: 'assistant/message', seq: 3, time: 300, surfaceOp: 'append', data: { turn: 1, message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'turn/end', seq: 4, time: 400, data: { turn: 1, reason: { kind: 'completed' } } },
]

const room: SessionLogRow[] = [
  { type: 'room/member-added', seq: 5, time: 500, data: { id: 'm-kimi', name: 'kimi' } },
  { type: 'room/member-added', seq: 6, time: 600, data: { id: 'm-coco', name: 'coco' } },
  { type: 'room/coordinator', seq: 7, time: 700, data: { memberId: 'm-kimi', previousMemberId: 'main' } },
  { type: 'room/dispatch', seq: 20, time: 5000, data: { origin: 'human', text: '你好', targets: ['coco'], targetIds: ['m-coco'] } },
  { type: 'room/run-state', seq: 21, time: 5050, data: { runId: '20:m-coco', member: 'coco', state: 'running', startedAt: 5050, elapsedMs: 0 } },
  { type: 'subagent/catalog', seq: 22, time: 5100, data: { childId: 'child-coco', mode: 'session', label: 'Codex' } },
  { type: 'room/run-state', seq: 23, time: 8050, data: { runId: '20:m-coco', member: 'coco', state: 'done', startedAt: 5050, elapsedMs: 3000, childSessionId: 'child-coco' } },
  { type: 'room/dispatch', seq: 30, time: 50_000, data: { origin: 'human', text: '列出工具', targets: ['coco'], targetIds: ['m-coco'] } },
  { type: 'room/run-state', seq: 31, time: 50_050, data: { runId: '30:m-coco', member: 'coco', state: 'done', startedAt: 50_050, elapsedMs: 4000, childSessionId: 'child-coco', childTurn: 2 } },
]

const childRequest = (startedAt: number, hostTurn: number): BuiltLogRequest => ({
  hostTurn, startedAt, settledAt: startedAt + 500, status: 'ok', config: { provider: 'codex' },
  usage: { inputTokens: 100, outputTokens: 10 },
  responseSummary: { kind: 'text' },
  segments: { system: [], tools: [], history: [], added: [] }, totalChars: 0,
  blocks: [], execs: [], fingerprint: { messageKeys: [], toolNames: [] },
})

function loaded(): InspectorStore {
  const rows = [...turn1, ...room]
  const store = new InspectorStore()
  store.insertLogTurns('s', reconstructSession(rows))
  for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
  store.appendLogRequest('s', 'child-coco', childRequest(6000, 1))
  store.appendLogRequest('s', 'child-coco', childRequest(51_000, 2))
  return store
}

describe('room rounds', () => {
  it('holds a child catalogued outside any turn without listing a turn for it', () => {
    const turns = reconstructSession([...turn1, ...room])
    expect(turns.find(t => t.purpose === 'room-members')?.delegations.map(d => d.childId)).toEqual(['child-coco'])
    expect(loaded().listTurns('s').turns.some(t => t.query === '')).toBe(false)
  })

  it('lists each human dispatch outside a main turn as a round, numbered with the main turns', () => {
    const list = loaded().listTurns('s')
    expect(list.turns.map(t => [t.ordinal, t.hostTurn, t.query, t.room?.targets])).toEqual([
      [1, 1, '邀请 Kimi', undefined],
      [2, undefined, '你好', ['coco']],
      [3, undefined, '列出工具', ['coco']],
    ])
    expect(list.total).toBe(3)
    expect(list.handoffs).toEqual([{ at: 700, name: 'kimi' }])
  })

  it('shows in a round only the requests of the run it started', () => {
    const store = loaded()
    const [, first, second] = store.listTurns('s').turns
    // By time span when the run names no child turn…
    const a = store.getTurn('s', first!.turnSeq)!.scopes
    expect(a.map(s => [s.scopeId, s.label, s.status, s.requests.map(r => r.startedAt)])).toEqual([['child-coco', 'coco', 'ok', [6000]]])
    // …by the child turn when it does.
    const b = store.getTurn('s', second!.turnSeq)!.scopes
    expect(b[0]?.requests.map(r => r.startedAt)).toEqual([51_000])
    // The session map carries them under their round.
    expect(store.getSessionTrend('s').requests.filter(r => r.turnSeq === first!.turnSeq).map(r => r.startedAt)).toEqual([6000])
  })

  it('skips a dispatch made inside a main turn', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(turn1))
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'mid-turn', targets: [] }, 9, 200)
    expect(store.listTurns('s').turns.map(t => t.query)).toEqual(['邀请 Kimi'])
  })
})
