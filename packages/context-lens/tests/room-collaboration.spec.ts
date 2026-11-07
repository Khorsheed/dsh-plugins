import { describe, expect, it } from 'vitest'
import { reconstructSession, type BuiltLogRequest, type ExecutionRecord, type SessionLogRow } from '../src/log-lane.ts'
import { collaborationRuns, applyRoomEvent, emptyRoom } from '../src/room.ts'
import { InspectorStore } from '../src/store.ts'

const rows: SessionLogRow[] = [
  { type: 'room/member-added', seq: 1, time: 1, data: { id: 'a', name: 'Agent A' } },
  { type: 'room/member-added', seq: 2, time: 2, data: { id: 'b', name: 'Agent B' } },
  { type: 'room/dispatch', seq: 10, time: 100, data: { origin: 'human', text: 'root', targets: ['Agent A'], messageId: 'root-message' } },
  { type: 'room/run-state', seq: 11, time: 101, data: { runId: '10:a', member: 'Agent A', state: 'running', startedAt: 100, childSessionId: 'child-a', executionId: 'e1' } },
  { type: 'room/dispatch', seq: 12, time: 200, data: { origin: 'coordinator', parent: '10:a', targets: ['Agent B'], text: 'nested' } },
  { type: 'room/run-state', seq: 13, time: 201, data: { runId: '12:b', member: 'Agent B', state: 'running', startedAt: 200, childSessionId: 'child-b', executionId: 'e2' } },
  { type: 'room/dispatch', seq: 14, time: 300, data: { origin: 'report', reportFor: '12:b', targets: ['Agent A'], text: 'report' } },
  { type: 'room/run-state', seq: 15, time: 301, data: { runId: '14:a', member: 'Agent A', state: 'running', startedAt: 300, childSessionId: 'child-a', executionId: 'e3' } },
  { type: 'room/decision', seq: 16, time: 302, data: { id: 'decision-b', scenario: 'report-timing', outcome: 'now', runId: '12:b', executionId: 'e2', call: { model: 'test', request: { state: {}, questions: [] } } } },
  { type: 'room/run-state', seq: 17, time: 303, data: { runId: '10:a', state: 'done', startedAt: 100, executionId: 'e1' } },
  { type: 'room/run-state', seq: 18, time: 304, data: { runId: '12:b', state: 'done', startedAt: 200, executionId: 'e2' } },
  { type: 'room/run-state', seq: 19, time: 305, data: { runId: '14:a', state: 'done', startedAt: 300, executionId: 'e3' } },
  { type: 'room/dispatch', seq: 20, time: 400, data: { origin: 'human', text: 'next human', targets: ['Agent A'] } },
  { type: 'subagent/catalog', seq: 30, time: 100, data: { childId: 'child-a', mode: 'session', label: 'Agent A' } },
  { type: 'subagent/catalog', seq: 31, time: 200, data: { childId: 'child-b', mode: 'session', label: 'Agent B' } },
]

function request(startedAt: number, executionId: string): BuiltLogRequest {
  return {
    hostTurn: executionId === 'e2' ? 1 : executionId === 'e1' ? 1 : 3,
    executionId, startedAt, settledAt: startedAt + 10, status: 'ok', config: {},
    usage: { inputTokens: 100, outputTokens: 10 }, responseSummary: { kind: 'text' },
    segments: { system: [], tools: [], history: [], added: [] }, totalChars: 0,
    blocks: [], execs: [], fingerprint: { messageKeys: [], toolNames: [] },
  }
}

function execution(phase: 'start' | 'end', executionId: string, cause?: Record<string, unknown>): ExecutionRecord {
  return phase === 'start'
    ? { phase, executionId, operation: 'prompt', cause }
    : { phase, executionId, outcome: 'done', turns: [executionId === 'e3' ? 3 : 1], unrecorded: [] }
}

function load(): InspectorStore {
  const store = new InspectorStore()
  store.insertLogTurns('s', reconstructSession(rows))
  for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
  for (const [child, id, at, cause] of [
    ['child-a', 'e1', 110, { kind: 'human' }],
    ['child-b', 'e2', 210, { kind: 'member', fromMemberId: 'a' }],
    ['child-a', 'e3', 310, { kind: 'execution' }],
  ] as const) {
    store.noteExecution(child, execution('start', id, cause))
    store.appendLogRequest('s', child, request(at, id))
    store.noteExecution(child, execution('end', id))
  }
  return store
}

describe('room collaboration tree', () => {
  it('keeps nested agents and repeated member executions in the human root round', () => {
    const store = load()
    const list = store.listTurns('s')
    expect(list.total).toBe(2)
    expect(list.turns.map(turn => [turn.ordinal, turn.query])).toEqual([[1, 'root'], [2, 'next human']])
    const root = list.turns[0]!
    expect(root.requestCount).toBe(3)
    expect(root.totalInputTokens).toBe(300)
    expect(root.roomDecisionIds).toEqual(['decision-b'])
    const scopes = store.getTurn('s', root.turnSeq)!.scopes
    expect(scopes.map(scope => [scope.label, scope.requests.map(request => request.startedAt)])).toEqual([
      ['Agent A', [110, 310]],
      ['Agent B', [210]],
    ])
    expect(scopes[0]?.execution).toBeUndefined()
    expect(scopes[0]?.executions?.map(execution => execution.executionId)).toEqual(['e1', 'e3'])
    expect(scopes[1]?.execution).toMatchObject({ executionId: 'e2', cause: 'member', fromMember: 'a' })
  })

  it('connects released reports only through recorded run links and tolerates cycles', () => {
    const state = emptyRoom()
    const extra: SessionLogRow[] = [
      { type: 'room/member-added', seq: 1, time: 1, data: { id: 'a', name: 'A' } },
      { type: 'room/member-added', seq: 2, time: 2, data: { id: 'b', name: 'B' } },
      { type: 'room/dispatch', seq: 10, time: 10, data: { origin: 'human', targets: ['A'] } },
      { type: 'room/run-state', seq: 11, time: 11, data: { runId: '10:a', member: 'A', state: 'running', startedAt: 10 } },
      { type: 'room/dispatch', seq: 12, time: 12, data: { origin: 'coordinator', parent: '10:a', targets: ['B'] } },
      { type: 'room/run-state', seq: 13, time: 13, data: { runId: '12:b', member: 'B', state: 'running', startedAt: 12 } },
      { type: 'room/dispatch', seq: 14, time: 14, data: { origin: 'report', reportFor: '12:b', targets: ['A'], held: true } },
      { type: 'room/dispatch', seq: 15, time: 15, data: { origin: 'report', releases: [14], targets: ['A'] } },
      { type: 'room/run-state', seq: 16, time: 16, data: { runId: '15:a', member: 'A', state: 'running', startedAt: 15 } },
      { type: 'room/dispatch', seq: 17, time: 17, data: { origin: 'coordinator', parent: '15:a', targets: ['B'] } },
      { type: 'room/run-state', seq: 18, time: 18, data: { runId: '17:b', member: 'B', state: 'running', startedAt: 17 } },
      { type: 'room/dispatch', seq: 19, time: 19, data: { origin: 'coordinator', parent: '17:b', targets: ['A'] } },
      { type: 'room/run-state', seq: 20, time: 20, data: { runId: '19:a', member: 'A', state: 'running', startedAt: 19 } },
      { type: 'room/dispatch', seq: 21, time: 21, data: { origin: 'coordinator', parent: '19:a', targets: ['B'] } },
      { type: 'room/run-state', seq: 22, time: 22, data: { runId: '21:b', member: 'B', state: 'running', startedAt: 20 } },
      { type: 'room/dispatch', seq: 23, time: 23, data: { origin: 'coordinator', parent: '21:b', targets: ['B'] } },
      { type: 'room/run-state', seq: 24, time: 24, data: { runId: '17:b', state: 'done' } },
      { type: 'room/dispatch', seq: 25, time: 25, data: { origin: 'report', reportFor: 'help:outside', targets: ['A'] } },
    ]
    for (const row of extra) applyRoomEvent(state, row.type, row.data, row.seq, row.time)
    expect(collaborationRuns(state, 10).map(run => run.runId)).toEqual(['10:a', '12:b', '15:a', '17:b', '19:a', '21:b'])
  })
})
