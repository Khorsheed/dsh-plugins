/**
 * Room rounds: once another member coordinates, a human's message to the room
 * runs no main turn — it dispatches member runs into their child sessions.
 * Each such dispatch is a round of its own, numbered with the main turns by
 * time; descendant coordinator/report dispatches join its collaboration tree
 * without adding rounds. What a round shows of its runs is decided per round,
 * by data: runs with write-side records (an execution id whose records live in
 * the child, or a child turn the room wrote) show exactly the requests those
 * records name; a round with none shows no room-dimension view, only each
 * member's own session and time span. Nothing is attributed by time.
 */
import { describe, expect, it } from 'vitest'
import { readExecutionRecord, reconstructSession, type BuiltLogRequest, type SessionLogRow } from '../src/log-lane.ts'
import { ROOM_UNATTRIBUTED_TURN, applyRoomEvent, emptyRoom } from '../src/room.ts'
import { InspectorStore } from '../src/store.ts'

const turn1: SessionLogRow[] = [
  { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
  { type: 'request/header', seq: 1, time: 100, data: { header: { config: { provider: 'deepseek', model: 'flash' }, tools: [] } } },
  { type: 'user/message', seq: 2, time: 200, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: '邀请 Kimi' }], source: { kind: 'user' } } },
  { type: 'assistant/message', seq: 3, time: 300, surfaceOp: 'append', data: { turn: 1, message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'turn/end', seq: 4, time: 400, data: { turn: 1, reason: { kind: 'completed' } } },
]

const roster: SessionLogRow[] = [
  { type: 'room/member-added', seq: 5, time: 500, data: { id: 'm-kimi', name: 'kimi' } },
  { type: 'room/member-added', seq: 6, time: 600, data: { id: 'm-coco', name: 'coco' } },
  { type: 'room/coordinator', seq: 7, time: 700, data: { memberId: 'm-kimi', previousMemberId: 'main' } },
]

/** A round from before any record: its run names neither an execution nor a child turn. */
const legacyRound: SessionLogRow[] = [
  { type: 'room/dispatch', seq: 20, time: 5000, data: { origin: 'human', text: '你好', targets: ['coco'], targetIds: ['m-coco'] } },
  { type: 'room/run-state', seq: 21, time: 5050, data: { runId: '20:m-coco', member: 'coco', state: 'running', startedAt: 5050, elapsedMs: 0 } },
  { type: 'subagent/catalog', seq: 22, time: 5100, data: { childId: 'child-coco', mode: 'session', label: 'Codex' } },
  { type: 'room/run-state', seq: 23, time: 8050, data: { runId: '20:m-coco', member: 'coco', state: 'done', startedAt: 5050, elapsedMs: 3000, childSessionId: 'child-coco' } },
]

/** A batch-4 round: the room wrote the child turn its run became. */
const childTurnRound: SessionLogRow[] = [
  { type: 'room/dispatch', seq: 30, time: 50_000, data: { origin: 'human', text: '列出工具', targets: ['coco'], targetIds: ['m-coco'] } },
  { type: 'room/run-state', seq: 31, time: 50_050, data: { runId: '30:m-coco', member: 'coco', state: 'done', startedAt: 50_050, elapsedMs: 4000, childSessionId: 'child-coco', childTurn: 2 } },
]

/** A batch-5 round: its run is a local-agent execution, recorded in the child. */
const executionRound: SessionLogRow[] = [
  { type: 'room/dispatch', seq: 40, time: 70_000, data: { origin: 'human', text: '写测试', targets: ['coco'], targetIds: ['m-coco'], messageId: 'u-40', task: 'u-40' } },
  { type: 'room/run-state', seq: 41, time: 70_050, data: { runId: '40:m-coco', member: 'coco', state: 'running', startedAt: 70_050, childSessionId: 'child-coco', executionId: 'e3' } },
  { type: 'room/run-state', seq: 42, time: 79_050, data: { runId: '40:m-coco', member: 'coco', state: 'done', startedAt: 70_050, elapsedMs: 9000, childSessionId: 'child-coco', executionId: 'e3', childTurn: 3 } },
]

const childRequest = (startedAt: number, hostTurn: number | undefined, executionId?: string): BuiltLogRequest => ({
  ...hostTurn === undefined ? {} : { hostTurn },
  ...executionId === undefined ? {} : { executionId },
  startedAt, settledAt: startedAt + 500, status: 'ok', config: { provider: 'codex' },
  usage: { inputTokens: 100, outputTokens: 10 },
  responseSummary: { kind: 'text' },
  segments: { system: [], tools: [], history: [], added: [] }, totalChars: 0,
  blocks: [], execs: [], fingerprint: { messageKeys: [], toolNames: [] },
})

const compaction = (startedAt: number, hostTurn: number | undefined, executionId: string | undefined, extra: Record<string, unknown> = {}): BuiltLogRequest => ({
  ...childRequest(startedAt, hostTurn, executionId), purpose: 'compaction', responseSummary: { kind: 'compaction' },
  compaction: { id: `cli:${startedAt}`, applied: true, inputPartial: true, ...hostTurn === undefined ? { betweenTurns: true } : { hostTurn }, source: hostTurn === undefined ? 'manual' : 'auto', ...extra },
})

const execution = (data: Record<string, unknown>) => readExecutionRecord(data, undefined)!

function load(rows: readonly SessionLogRow[], child: (store: InspectorStore) => void = () => {}): InspectorStore {
  const store = new InspectorStore()
  store.insertLogTurns('s', reconstructSession(rows))
  for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
  child(store)
  return store
}

/** The member's own log as lens read it: one request per turn, plus a codex auto compaction inside turn 3. */
function memberLog(store: InspectorStore): void {
  store.appendLogRequest('s', 'child-coco', childRequest(6000, 1))
  store.appendLogRequest('s', 'child-coco', childRequest(51_000, 2))
  store.noteExecution('child-coco', execution({ phase: 'start', executionId: 'e3', caller: 'room', operation: 'prompt', cause: { kind: 'human', sessionId: 's', dispatchSeq: 40, via: 'room' }, task: { sessionId: 's', id: 'u-40' } }))
  store.appendLogRequest('s', 'child-coco', childRequest(71_000, 3, 'e3'))
  store.appendLogRequest('s', 'child-coco', compaction(72_000, 3, 'e3', { beforeTokens: 180_000, unrecorded: ['usage'] }))
  store.noteExecution('child-coco', execution({ phase: 'end', executionId: 'e3', outcome: 'done', turns: [3], unrecorded: ['internal-calls'] }))
}

const all = [...turn1, ...roster, ...legacyRound, ...childTurnRound, ...executionRound]

describe('room rounds', () => {
  it('holds a child catalogued outside any turn without listing a turn for it', () => {
    const turns = reconstructSession(all)
    expect(turns.find(t => t.purpose === 'room-members')?.delegations.map(d => d.childId)).toEqual(['child-coco'])
    expect(load(all, memberLog).listTurns('s').turns.some(t => t.query === '' && t.roomUnattributed !== true)).toBe(false)
  })

  it('lists each human dispatch outside a main turn as a round, numbered with the main turns', () => {
    const list = load(all, memberLog).listTurns('s')
    expect(list.turns.map(t => [t.ordinal, t.hostTurn, t.query, t.room?.targets])).toEqual([
      [1, 1, '邀请 Kimi', undefined],
      [2, undefined, '你好', ['coco']],
      [3, undefined, '列出工具', ['coco']],
      [4, undefined, '写测试', ['coco']],
    ])
    expect(list.total).toBe(4)
    expect(list.handoffs).toEqual([{ at: 700, name: 'kimi' }])
  })

  it('decides per round by data: an old round falls back, recorded rounds show what their records name', () => {
    const store = load(all, memberLog)
    const list = store.listTurns('s')
    // Mixed: some round is recorded, so no session-wide notice.
    expect(list.roomRecords).toBe('some')
    const [, legacy, byTurn, byExecution] = list.turns
    // The old round: no room-dimension view, the member's own session and time span instead.
    expect(legacy!.room).toMatchObject({ unrecorded: true })
    const fallback = store.getTurn('s', legacy!.turnSeq)!
    expect(fallback.scopes).toEqual([])
    expect(fallback.roomFallback).toEqual({ members: [{ name: 'coco', sessionId: 'child-coco', startedAt: 5050, endedAt: 8050 }] })
    // Its member request is not claimed by time (it stays in the member's own lens).
    expect(store.getSessionTrend('s').requests.some(r => r.startedAt === 6000)).toBe(false)
    // The batch-4 round: the child turn the room wrote.
    expect(byTurn!.room?.unrecorded).toBeUndefined()
    expect(store.getTurn('s', byTurn!.turnSeq)!.scopes.map(s => [s.scopeId, s.label, s.status, s.requests.map(r => r.startedAt)])).toEqual([['child-coco', 'coco', 'ok', [51_000]]])
    // The batch-5 round: its execution's records, with its compaction in the 压缩 tab.
    const scopes = store.getTurn('s', byExecution!.turnSeq)!.scopes
    expect(scopes.map(s => [s.scopeId, s.kind, s.requests.map(r => r.startedAt)])).toEqual([
      ['child-coco', 'subagent', [71_000]],
      ['compaction:child-coco', 'compaction', [72_000]],
    ])
    expect(scopes[0]!.execution).toEqual({ executionId: 'e3', cause: 'human', outcome: 'done', unrecorded: ['internal-calls'] })
    expect(scopes[1]!.compaction?.member).toMatchObject({ name: 'coco', source: 'auto', beforeTokens: 180_000, unrecorded: ['usage'] })
  })

  it('a session where no round carries records says so once: every round is a fallback', () => {
    const store = load([...turn1, ...roster, ...legacyRound], s => s.appendLogRequest('s', 'child-coco', childRequest(6000, 1)))
    const list = store.listTurns('s')
    expect(list.roomRecords).toBe('none')
    expect(list.turns.filter(t => t.room !== undefined).every(t => t.room?.unrecorded === true)).toBe(true)
  })

  it('a session without rounds reports nothing about room records', () => {
    expect(load(turn1).listTurns('s').roomRecords).toBeUndefined()
  })

  it('an execution claims only what its records name, never what falls in its time span', () => {
    const store = load(all, s => {
      memberLog(s)
      // Inside the run's span, but another turn and no bracket: not this run's.
      s.appendLogRequest('s', 'child-coco', childRequest(75_000, 9))
    })
    const round = store.listTurns('s').turns.find(t => t.query === '写测试')!
    expect(store.getTurn('s', round.turnSeq)!.scopes[0]!.requests.map(r => r.startedAt)).toEqual([71_000])
  })

  it('a run whose execution has not ended yet holds what its start record brackets so far', () => {
    const rows = [...turn1, ...roster, ...legacyRound, ...executionRound.filter(row => row.seq !== 42)]
    const store = load(rows, s => {
      s.noteExecution('child-coco', execution({ phase: 'start', executionId: 'e3', caller: 'room', operation: 'prompt' }))
      s.appendLogRequest('s', 'child-coco', childRequest(71_000, 3, 'e3'))
      s.appendLogRequest('s', 'child-coco', childRequest(91_000, 4))
    })
    const round = store.listTurns('s').turns.find(t => t.query === '写测试')!
    const scope = store.getTurn('s', round.turnSeq)!.scopes[0]!
    expect([scope.status, scope.requests.map(r => r.startedAt)]).toEqual(['running', [71_000]])
    expect(scope.execution).toEqual({ executionId: 'e3' })
  })

  it('a /compact is a round: the compaction its execution brackets shows in that round\'s 压缩 tab', () => {
    const rows = [...all,
      { type: 'room/dispatch', seq: 50, time: 90_000, data: { origin: 'human', text: '/compact', targets: ['coco'], targetIds: ['m-coco'] } },
      { type: 'room/run-state', seq: 51, time: 90_050, data: { runId: '50:m-coco', member: 'coco', state: 'done', operation: 'compact', startedAt: 90_050, elapsedMs: 900, childSessionId: 'child-coco', executionId: 'e4' } },
    ] satisfies SessionLogRow[]
    const store = load(rows, s => {
      memberLog(s)
      s.noteExecution('child-coco', execution({ phase: 'start', executionId: 'e4', caller: 'room', operation: 'compact' }))
      s.appendLogRequest('s', 'child-coco', compaction(90_100, undefined, 'e4', { unrecorded: ['usage', 'before-after', 'summary'] }))
      s.noteExecution('child-coco', execution({ phase: 'end', executionId: 'e4', outcome: 'done', turns: [], unrecorded: ['compaction'] }))
    })
    const list = store.listTurns('s')
    expect(list.turns.map(t => t.query)).toEqual(['邀请 Kimi', '你好', '列出工具', '写测试', '/compact'])
    // Its own round, numbered with the others; nothing is left unattributed.
    const compactRound = list.turns.at(-1)!
    expect([compactRound.ordinal, compactRound.roomUnattributed]).toEqual([5, undefined])
    const scopes = store.getTurn('s', compactRound.turnSeq)!.scopes
    expect(scopes.map(s => [s.scopeId, s.kind, s.requests.map(r => r.startedAt)])).toEqual([['compaction:child-coco', 'compaction', [90_100]]])
    expect(scopes[0]!.compaction?.member).toMatchObject({ name: 'coco', source: 'manual', unrecorded: ['usage', 'before-after', 'summary'] })
    expect(store.getTurn('s', ROOM_UNATTRIBUTED_TURN)).toBeUndefined()
    // The round before it does not claim it.
    const round = list.turns.find(t => t.query === '写测试')!
    expect(store.getTurn('s', round.turnSeq)!.scopes.flatMap(s => s.requests.map(r => r.startedAt))).toEqual([71_000, 72_000])
  })

  it('a compaction inside an execution no round claims (a member-page round) goes to 未归轮', () => {
    const store = load(all, s => {
      memberLog(s)
      s.noteExecution('child-coco', execution({ phase: 'start', executionId: 'e-page', caller: 'composer', operation: 'prompt' }))
      s.appendLogRequest('s', 'child-coco', childRequest(95_000, 5, 'e-page'))
      s.appendLogRequest('s', 'child-coco', compaction(95_500, 5, 'e-page', { unrecorded: ['usage'] }))
      s.noteExecution('child-coco', execution({ phase: 'end', executionId: 'e-page', outcome: 'done', turns: [5], unrecorded: [] }))
    })
    const list = store.listTurns('s')
    // Listed last, unnumbered, never a landing turn.
    const group = list.turns.at(-1)!
    expect([group.roomUnattributed, group.turnSeq, group.ordinal]).toEqual([true, ROOM_UNATTRIBUTED_TURN, undefined])
    const scopes = store.getTurn('s', ROOM_UNATTRIBUTED_TURN)!.scopes
    expect(scopes.map(s => [s.scopeId, s.requests.map(r => r.startedAt)])).toEqual([['compaction:unattributed:child-coco', [95_500]]])
    expect(scopes[0]!.compaction?.member).toMatchObject({ source: 'auto', unrecorded: ['usage'] })
  })

  it('a decision naming an execution lands on the round whose run is that execution', () => {
    const store = load(all, memberLog)
    store.noteRoomEvent('s', 'room/decision', { id: 'd-exec', scenario: 'report-timing', outcome: 'now', about: {}, executionId: 'e3',
      call: { model: 'jev-latest', request: { state: {}, questions: [] } } }, 60, 20)
    expect(store.listTurns('s').turns.find(t => t.query === '写测试')!.roomDecisionIds).toEqual(['d-exec'])
  })

  it('a compaction of an unrecorded round is not hidden either', () => {
    const store = load([...turn1, ...roster, ...legacyRound], s => {
      s.appendLogRequest('s', 'child-coco', childRequest(6000, 1))
      s.appendLogRequest('s', 'child-coco', compaction(7000, 1, undefined, { beforeTokens: 100_000 }))
    })
    const scopes = store.getTurn('s', ROOM_UNATTRIBUTED_TURN)!.scopes
    expect(scopes.map(s => s.requests.map(r => r.startedAt))).toEqual([[7000]])
  })

  it('keeps a relay delivery\'s UUID run: it is no round, but its child turn is its own', () => {
    const rows = [...turn1, ...roster, ...childTurnRound,
      { type: 'subagent/catalog', seq: 32, time: 50_100, data: { childId: 'child-coco', mode: 'session', label: 'Codex' } },
      { type: 'room/run-state', seq: 40, time: 60_000, data: { runId: '0b6e4f62-5a2c-4c1e-9a53-2f4d1c7e8a90', member: 'coco', state: 'running', startedAt: 60_000 } },
      { type: 'room/run-state', seq: 41, time: 64_000, data: { runId: '0b6e4f62-5a2c-4c1e-9a53-2f4d1c7e8a90', member: 'coco', state: 'done', startedAt: 60_000, elapsedMs: 4000, childSessionId: 'child-coco', childTurn: 7 } },
    ] satisfies SessionLogRow[]
    const state = emptyRoom()
    for (const row of rows) if (row.type.startsWith('room/')) applyRoomEvent(state, row.type, row.data, row.seq, row.time)
    const relayRun = state.runs.get('0b6e4f62-5a2c-4c1e-9a53-2f4d1c7e8a90')
    expect(relayRun).toMatchObject({ memberId: 'm-coco', state: 'done', endedAt: 64_000, childTurn: 7 })
    expect(relayRun?.dispatchSeq).toBeUndefined()
    const store = load(rows, s => {
      s.appendLogRequest('s', 'child-coco', childRequest(51_000, 2))
      s.appendLogRequest('s', 'child-coco', childRequest(61_000, 7))
    })
    const rounds = store.listTurns('s').turns.filter(t => t.room !== undefined)
    expect(rounds).toHaveLength(1)
    expect(store.getTurn('s', rounds[0]!.turnSeq)!.scopes[0]?.requests.map(r => r.startedAt)).toEqual([51_000])
  })

  it('keeps a legacy run without a run id, keyed by its member and start', () => {
    const state = emptyRoom()
    applyRoomEvent(state, 'room/member-added', { id: 'm-coco', name: 'coco' }, 1, 1)
    applyRoomEvent(state, 'room/run-state', { member: 'coco', state: 'running', startedAt: 100 }, 2, 100)
    applyRoomEvent(state, 'room/run-state', { member: 'coco', state: 'failed', startedAt: 100, elapsedMs: 50 }, 3, 150)
    expect([...state.runs.values()]).toEqual([{ runId: 'legacy:coco:100', memberId: 'm-coco', member: 'coco', state: 'failed', startedAt: 100, endedAt: 150 }])
  })

  it('a cancelled run reads cancelled and ends where it was cancelled', () => {
    // The room records a stop without elapsedMs; the run must not stay open until the next dispatch.
    const rows = [...turn1, ...roster, ...legacyRound.filter(row => row.seq !== 23),
      { type: 'room/run-state', seq: 23, time: 7000, data: { runId: '20:m-coco', member: 'coco', state: 'cancelled', startedAt: 5050, childSessionId: 'child-coco', executionId: 'e1' } },
    ] satisfies SessionLogRow[]
    const [, first] = load(rows).listTurns('s').turns
    const scope = load(rows).getTurn('s', first!.turnSeq)!.scopes[0]!
    expect(scope.status).toBe('cancelled')
    expect(scope.endedAt).toBe(7000)
  })

  it('a member renamed by name keeps its runs labelled with the new name', () => {
    const state = emptyRoom()
    applyRoomEvent(state, 'room/member-added', { id: 'm-coco', name: 'coco' }, 1, 1)
    applyRoomEvent(state, 'room/member-updated', { name: 'coco', role: '测试' }, 2, 2)
    expect(state.members.get('m-coco')).toBe('coco')
    applyRoomEvent(state, 'room/member-updated', { name: 'coco', rename: 'codex' }, 3, 3)
    expect(state.members.get('m-coco')).toBe('codex')
  })

  it('a round anchored on the human message carries where the chat pages back to', () => {
    const store = load(all)
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'x', targets: ['coco'], messageId: 'u9' }, 90, 90_000)
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'y', targets: ['coco'] }, 95, 95_000)
    const [x, y] = store.listTurns('s').turns.filter(t => t.room !== undefined && t.query !== '你好' && t.query !== '列出工具' && t.query !== '写测试')
    expect([x?.room?.messageId, x?.startSeq]).toEqual(['u9', 78])
    expect(y?.startSeq).toBeUndefined()
  })

  it('a dispatch that recorded no message has no chat anchor (no lookup by text)', () => {
    const rows = [...turn1, ...roster,
      { type: 'user/message', seq: 19, time: 4900, data: { id: 'own', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
      ...legacyRound,
    ] satisfies SessionLogRow[]
    expect(load(rows).listTurns('s').turns.map(t => t.room?.messageId)).toEqual([undefined, undefined])
  })

  it('skips a dispatch made inside a main turn', () => {
    const store = load(turn1)
    store.noteRoomEvent('s', 'room/dispatch', { origin: 'human', text: 'mid-turn', targets: [] }, 9, 200)
    expect(store.listTurns('s').turns.map(t => t.query)).toEqual(['邀请 Kimi'])
  })
})

describe('room decisions', () => {
  const call = (latencyMs: number) => ({ model: 'jev-latest', latencyMs, cached: false, inputTokens: 412, outputTokens: 9,
    request: { state: { message: '残片也修一下', openTasks: [{ number: 1, title: '你好' }] }, questions: [{ id: 'task', type: 'choice', instructions: 'Does the message …' }] },
    response: [{ id: 'task', answer: '1', probabilities: { '1': 0.82, new: 0.18 } }] })
  const decisions: SessionLogRow[] = [
    // Gated the batch-4 round's run: that round, by the run it names.
    { type: 'room/decision', seq: 32, time: 52_000, data: { id: 'd-run', scenario: 'report-timing', outcome: 'later', probability: 0.2, call: call(800), about: { from: 'coco', to: 'kimi' }, runId: '30:m-coco', task: '30' } },
    // Filed the batch-5 round's human message: that round, by the message it names.
    { type: 'room/decision', seq: 43, time: 70_010, data: { id: 'd-message', scenario: 'task-filing', outcome: 'new', probability: 0.7, call: call(1200), about: { message: 'u-40' }, task: 'u-40' } },
    // Gated a coordinator's run (no round): the task it names, that task's first round.
    { type: 'room/decision', seq: 44, time: 75_000, data: { id: 'd-task', scenario: 'report-timing', outcome: 'now', probability: 0.9, call: call(600), about: { from: 'coco', to: 'kimi' }, runId: '99:m-coco', task: 'u-40' } },
    // Written inside main turn 1.
    { type: 'room/decision', seq: 2, time: 250, data: { id: 'd-main', scenario: 'task-filing', outcome: 'new', call: call(300), about: { message: 'u1' } } },
    // A pre-S9 call naming nothing: no record ties it anywhere, so it is in the 未归轮 group (never the round it fell in by time).
    { type: 'room/decision', seq: 33, time: 52_500, data: { id: 'd-loose', scenario: 'report-timing', outcome: 'now', rule: 'unavailable', about: { from: 'coco', to: 'kimi' },
      call: { model: 'jev-latest', latencyMs: 8000, request: { state: {}, questions: [] }, failure: { reason: 'timeout' } } } },
    // A rule decision carries no call: no request to list.
    { type: 'room/decision', seq: 34, time: 53_000, data: { id: 'd-rule', scenario: 'report-timing', outcome: 'now', rule: 'last', about: { from: 'coco', to: 'kimi' } } },
  ]

  it('attaches each decision-model call to the turn its records name; the rest go to 未归轮; rule decisions are not requests', () => {
    const store = load(all, memberLog)
    for (const row of decisions) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    const list = store.listTurns('s')
    const byQuery = new Map(list.turns.map(t => [t.roomUnattributed ? '未归轮' : t.query, t.roomDecisionIds]))
    expect(Object.fromEntries(byQuery)).toEqual({
      '邀请 Kimi': ['d-main'], '你好': undefined, '列出工具': ['d-run'], '写测试': ['d-message', 'd-task'], '未归轮': ['d-loose'],
    })
    const round = list.turns.find(t => t.query === '列出工具')!
    expect(store.getTurn('s', round.turnSeq)!.roomDecisions).toMatchObject([{ id: 'd-run', scenario: 'report-timing', probability: 0.2, model: 'jev-latest', latencyMs: 800, inputTokens: 412, outputTokens: 9,
      runId: '30:m-coco', request: { state: { message: '残片也修一下' } }, response: [{ answer: '1' }] }])
    expect(store.getTurn('s', ROOM_UNATTRIBUTED_TURN)!.roomDecisions).toMatchObject([{ id: 'd-loose', failure: { reason: 'timeout' } }])
    // A scope filter that hides the room's own view hides its decisions too.
    expect(store.getTurn('s', round.turnSeq, { scopes: ['child-coco'] })!.roomDecisions).toBeUndefined()
  })
})
