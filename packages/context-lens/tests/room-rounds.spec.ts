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

  it('a /compact is no round: its compaction shows in the 压缩 tab of the member\'s previous round', () => {
    const rows = [...turn1, ...room,
      { type: 'room/dispatch', seq: 40, time: 60_000, data: { origin: 'human', text: '/compact', targets: ['coco'], targetIds: ['m-coco'] } },
      // Before the producer stopped borrowing it, a /compact run named the previous child turn too.
      { type: 'room/run-state', seq: 41, time: 60_050, data: { runId: '40:m-coco', member: 'coco', state: 'done', startedAt: 60_050, elapsedMs: 9000, childSessionId: 'child-coco', childTurn: 2 } },
    ] satisfies SessionLogRow[]
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(rows))
    for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    store.appendLogRequest('s', 'child-coco', childRequest(6000, 1))
    store.appendLogRequest('s', 'child-coco', childRequest(51_000, 2))
    store.appendLogRequest('s', 'child-coco', { ...childRequest(60_100, 2), settledAt: 69_000, purpose: 'compaction', responseSummary: { kind: 'compaction' },
      usage: { inputTokens: 266_149, outputTokens: 2_819, cacheReadTokens: 18_944 },
      compaction: { id: 'cli:9', applied: true, inputPartial: true, hostTurn: 2, betweenTurns: true, source: 'manual', beforeTokens: 288_536, afterTokens: 44_671 } })
    const list = store.listTurns('s')
    expect(list.turns.map(t => t.query)).toEqual(['邀请 Kimi', '你好', '列出工具'])
    const scopes = store.getTurn('s', list.turns[2]!.turnSeq)!.scopes
    expect(scopes.map(scope => [scope.scopeId, scope.kind, scope.requests.length])).toEqual([
      ['child-coco', 'subagent', 1],
      ['compaction:child-coco', 'compaction', 1],
    ])
    expect(scopes[1]!.compaction).toEqual({ member: { name: 'coco', source: 'manual', beforeTokens: 288_536, afterTokens: 44_671 } })
  })

  it('a run that never recorded its end stops at the member\'s next run, never claiming later requests', () => {
    // The first run is stuck at `running` (its done/cancelled lost to a restart): no end, no child turn.
    const stuck = room.filter(row => row.seq !== 23)
    const rows = [...turn1, ...stuck,
      { type: 'room/dispatch', seq: 40, time: 90_000, data: { origin: 'human', text: '再来', targets: ['coco'], targetIds: ['m-coco'] } },
      { type: 'room/run-state', seq: 41, time: 90_050, data: { runId: '40:m-coco', member: 'coco', state: 'done', startedAt: 90_050, elapsedMs: 4000, childSessionId: 'child-coco' } },
    ] satisfies SessionLogRow[]
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(rows))
    for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    store.appendLogRequest('s', 'child-coco', childRequest(6000, 1))
    store.appendLogRequest('s', 'child-coco', childRequest(51_000, 2))
    store.appendLogRequest('s', 'child-coco', childRequest(91_000, 3))
    const [, first, second, third] = store.listTurns('s').turns
    expect(store.getTurn('s', first!.turnSeq)!.scopes[0]?.requests.map(r => r.startedAt)).toEqual([6000])
    expect(store.getTurn('s', second!.turnSeq)!.scopes[0]?.requests.map(r => r.startedAt)).toEqual([51_000])
    expect(store.getTurn('s', third!.turnSeq)!.scopes[0]?.requests.map(r => r.startedAt)).toEqual([91_000])
    const seqs = store.getSessionTrend('s').requests.filter(r => r.scopeId === 'child-coco').map(r => r.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('a round anchored on the human message carries where the chat pages back to', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession([...turn1, ...room]))
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'x', targets: ['coco'], messageId: 'u9' }, 90, 90_000)
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'y', targets: ['coco'] }, 95, 95_000)
    const [x, y] = store.listTurns('s').turns.filter(t => t.room !== undefined)
    expect([x?.room?.messageId, x?.startSeq]).toEqual(['u9', 78])
    expect(y?.startSeq).toBeUndefined()
  })

  it('skips a dispatch made inside a main turn', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(turn1))
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'mid-turn', targets: [] }, 9, 200)
    expect(store.listTurns('s').turns.map(t => t.query)).toEqual(['邀请 Kimi'])
  })
})

describe('room decisions', () => {
  const call = (latencyMs: number) => ({ model: 'jev-latest', latencyMs, cached: false, inputTokens: 412, outputTokens: 9,
    request: { state: { message: '残片也修一下', openTasks: [{ number: 1, title: '你好' }] }, questions: [{ id: 'task', type: 'choice', instructions: 'Does the message …' }] },
    response: [{ id: 'task', answer: '1', probabilities: { '1': 0.82, new: 0.18 } }] })
  const decisions: SessionLogRow[] = [
    // In the first round (after its dispatch at 5000): a filing the model decided.
    { type: 'room/decision', seq: 24, time: 6200, data: { id: 'd1', scenario: 'task-filing', outcome: '1', probability: 0.82, call: call(1200), about: { task: { number: 1, title: '你好' } } } },
    // A rule decision carries no call: no request to list.
    { type: 'room/decision', seq: 25, time: 7000, data: { id: 'd2', scenario: 'report-timing', outcome: 'now', rule: 'last', about: { from: 'coco', to: 'kimi' } } },
    // In the second round: a timing call that failed.
    { type: 'room/decision', seq: 32, time: 52_000, data: { id: 'd3', scenario: 'report-timing', outcome: 'now', rule: 'unavailable', about: { from: 'coco', to: 'kimi' },
      call: { model: 'jev-latest', latencyMs: 8000, request: { state: {}, questions: [] }, failure: { reason: 'timeout' } } } },
  ]

  it('attaches each decision-model call to the round it happened in; rule decisions are not requests', () => {
    const store = loaded()
    for (const row of decisions) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    const [main, first, second] = store.listTurns('s').turns
    expect(main!.roomDecisionIds).toBeUndefined()
    expect(first!.roomDecisionIds).toEqual(['d1'])
    expect(second!.roomDecisionIds).toEqual(['d3'])
    const rows = store.getTurn('s', first!.turnSeq)!.roomDecisions!
    expect(rows).toMatchObject([{ id: 'd1', scenario: 'task-filing', probability: 0.82, model: 'jev-latest', latencyMs: 1200, inputTokens: 412, outputTokens: 9,
      request: { state: { message: '残片也修一下' } }, response: [{ answer: '1' }] }])
    expect(store.getTurn('s', second!.turnSeq)!.roomDecisions).toMatchObject([{ id: 'd3', failure: { reason: 'timeout' } }])
    // A scope filter that hides the room's own view hides its decisions too.
    expect(store.getTurn('s', first!.turnSeq, { scopes: ['child-coco'] })!.roomDecisions).toBeUndefined()
  })
})

describe('room round scroll anchor', () => {
  it('a round carries the human message the post appended, matched by text before the nearest', async () => {
    const { humanMessageBefore } = await import('../src/service.ts')
    const rows: SessionLogRow[] = [
      { type: 'user/message', seq: 39, time: 1, data: { id: 'other', source: { kind: 'user' }, content: [{ type: 'text', text: '别的' }] } },
      { type: 'user/message', seq: 40, time: 1, data: { id: 'own', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
      { type: 'user/message', seq: 41, time: 1, data: { id: 'brief', source: { kind: 'room' }, content: [{ type: 'text', text: '【房间简报】' }] } },
    ]
    const bySeq = new Map(rows.map(row => [row.seq as number, row]))
    expect(humanMessageBefore(seq => bySeq.get(seq), 42, { origin: 'human', text: '你好' })).toBe('own')
    expect(humanMessageBefore(seq => bySeq.get(seq), 42, { origin: 'human', text: '改过的' })).toBe('own')
    expect(humanMessageBefore(seq => bySeq.get(seq), 42, { origin: 'coordinator', text: '你好' })).toBeUndefined()
    const store = new InspectorStore()
    const all = [...turn1, ...room]
    store.insertLogTurns('s', reconstructSession(all))
    for (const row of all) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.seq === 20 ? { ...row.data as object, messageId: 'own' } : row.data, row.seq, row.time)
    expect(store.listTurns('s').turns.map(t => t.room?.messageId)).toEqual([undefined, 'own', undefined])
  })
})
