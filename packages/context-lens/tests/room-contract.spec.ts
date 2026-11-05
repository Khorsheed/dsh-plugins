/**
 * Room → Context Lens contract: replay the room log and the member's child
 * log that room's REAL writers produced (fixtures/room-contract.json,
 * generated and kept fresh by room's `tests/lens-contract.host.spec.ts`)
 * through lens's own parsers, and check the lens view of each fact room
 * writes. Lens keeps no dependency on room; the fixture is the only coupling.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { foldLogRows, openCursor, reconstructSession, type BuiltLogRequest, type SessionLogRow } from '../src/log-lane.ts'
import { ROOM_UNATTRIBUTED_TURN, applyRoomEvent, emptyRoom, isCompactCommand, type RoomState } from '../src/room.ts'
import { InspectorStore } from '../src/store.ts'

interface Fixture {
  readonly roomRows: SessionLogRow[]
  /** The member's child session (`child-ada`) as room's run entry wrote it: turns and `local-agent/execution` records. */
  readonly childRows: SessionLogRow[]
  readonly compactCases: { readonly text: string; readonly compact: boolean }[]
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/room-contract.json', import.meta.url), 'utf8')) as Fixture
const rows = fixture.roomRows
const data = (row: SessionLogRow): Record<string, unknown> => row.data as Record<string, unknown>
const runStates = rows.filter(row => row.type === 'room/run-state')
const runState = (runId: string, state: string): Record<string, unknown> => data(runStates.find(row => data(row)['runId'] === runId && data(row)['state'] === state)!)
const ada = data(rows.find(row => row.type === 'room/member-added' && data(row)['name'] === 'ada')!)['id'] as string
const userMessageId = (text: string): unknown => data(rows.find(row => row.type === 'user/message' && JSON.stringify(row.data).includes(text))!)['id']

function roomState(): RoomState {
  const state = emptyRoom()
  for (const row of rows) applyRoomEvent(state, row.type, row.data, row.seq, row.time)
  return state
}

const childRequest = (startedAt: number, hostTurn: number): BuiltLogRequest => ({
  hostTurn, startedAt, settledAt: startedAt + 1, status: 'ok', config: { provider: 'kimi' },
  usage: { inputTokens: 100, outputTokens: 10 },
  responseSummary: { kind: 'text' },
  segments: { system: [], tools: [], history: [], added: [] }, totalChars: 0,
  blocks: [], execs: [], fingerprint: { messageKeys: [], toolNames: [] },
})

function loaded(): InspectorStore {
  const store = new InspectorStore()
  // The host (not room) catalogues the member's child session when local-agent opens it.
  const opened = (runStates[0]!.data as { startedAt: number }).startedAt + 1
  const catalog: SessionLogRow = { type: 'subagent/catalog', seq: 10_000, time: opened, data: { childId: 'child-ada', mode: 'session', label: 'Kimi' } }
  store.insertLogTurns('s', reconstructSession([...rows, catalog]))
  for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
  // The member's child log through the child lane's own fold: its execution
  // records and its compactions (the shim writes no model steps).
  for (const request of foldLogRows(openCursor(), fixture.childRows, { execution: record => store.noteExecution('child-ada', record) })) {
    store.appendLogRequest('s', 'child-ada', request)
  }
  // One model request per round the room recorded (childTurn 1–7), at its run's start + 5 ms.
  for (const row of runStates) {
    const d = data(row)
    if (typeof d['childTurn'] === 'number') store.appendLogRequest('s', 'child-ada', childRequest((d['startedAt'] as number) + 5, d['childTurn']))
  }
  return store
}

const roundOf = (store: InspectorStore, query: string) => store.listTurns('s').turns.find(turn => turn.query.startsWith(query))!

describe('room → Context Lens contract (fixture from room\'s writers)', () => {
  it('each human dispatch outside a main turn is a round anchored on the human\'s own message, /compact included; relay deliveries are not rounds', () => {
    const list = loaded().listTurns('s')
    const rounds = list.turns.filter(turn => turn.room !== undefined)
    expect(rounds.map(turn => turn.query.slice(0, 3))).toEqual(['搭骨架', '第二轮', '长任务', '/co', '/co', '第三轮'])
    expect(rounds.map(turn => turn.room?.messageId)).toEqual([
      undefined, userMessageId('@ada 第二轮'), userMessageId('@bea 长任务'), expect.anything(), expect.anything(), userMessageId('@bea 第三轮'),
    ])
  })

  it('every round room\'s run entry wrote is recorded: no fallback anywhere', () => {
    const list = loaded().listTurns('s')
    expect(list.roomRecords).toBe('some')
    expect(list.turns.filter(turn => turn.room?.unrecorded === true)).toEqual([])
  })

  it('a round holds its own run: child, state, and the requests its execution records name', () => {
    const store = loaded()
    // The member's requests stand at each run's start + 5 ms; a round shows only its run's.
    const at = (runId: string): number => (runState(runId, 'running')['startedAt'] as number) + 5
    expect(store.getTurn('s', roundOf(store, '搭骨架').turnSeq)!.scopes.map(scope => [scope.scopeId, scope.status, scope.requests.map(request => request.startedAt)]))
      .toEqual([['child-ada', 'ok', [at(`3:${ada}`)]]])
    const second = store.getTurn('s', roundOf(store, '第二轮').turnSeq)!.scopes[0]!
    expect(second.requests.map(request => request.startedAt)).toEqual([at(`11:${ada}`)])
    // Its execution's start record says why it ran.
    expect(second.execution).toMatchObject({ executionId: runState(`11:${ada}`, 'running')['executionId'], cause: 'human', outcome: 'done' })
    // The stopped round: cancelled, ended at startedAt + elapsedMs as room wrote them.
    const cancelled = runState(`19:${ada}`, 'cancelled')
    const scope = store.getTurn('s', roundOf(store, '长任务').turnSeq)!.scopes[0]!
    expect([scope.status, scope.startedAt, scope.endedAt, scope.requests.map(request => request.startedAt), scope.execution?.outcome])
      .toEqual(['cancelled', cancelled['startedAt'], (cancelled['startedAt'] as number) + (cancelled['elapsedMs'] as number), [at(`19:${ada}`)], 'cancelled'])
  })

  it('a rename addressed by the member\'s current name reaches the roster', () => {
    expect(roomState().members.get(ada)).toBe('bea')
  })

  it('a relay delivery\'s UUID run is kept for its member, with its own child turn', () => {
    const uuidRun = runStates.map(row => data(row)['runId'] as string).find(id => !id.includes(':'))!
    expect(uuidRun).toMatch(/^[0-9a-f-]{36}$/)
    const run = roomState().runs.get(uuidRun)
    expect(run).toMatchObject({ memberId: ada, member: 'bea', state: 'done', childTurn: 4, childSessionId: 'child-ada' })
    expect(run?.dispatchSeq).toBeUndefined()
  })

  it('a compaction run claims no child turn; its compaction is the one its execution brackets, in its own round\'s 压缩 tab', () => {
    const compactRun = runStates.find(row => data(row)['operation'] === 'compact' && data(row)['state'] === 'done')!
    expect(data(compactRun)['childTurn']).toBeUndefined()
    // Batch 5 S6: room no longer copies the compaction's numbers; they stay on
    // the member log's `local-agent/compaction` fact (the one lens reads).
    expect(rows.some(row => row.type === 'room/member-compacted')).toBe(true)
    expect(rows.some(row => row.type === 'room/member-compacted' && 'beforeTokens' in data(row))).toBe(false)
    const store = loaded()
    const compactRounds = store.listTurns('s').turns.filter(turn => turn.query.startsWith('/compact'))
    const views = compactRounds.map(turn => store.getTurn('s', turn.turnSeq)!.scopes)
    expect(views.map(scopes => scopes.map(scope => [scope.scopeId, scope.requests.length]))).toEqual([
      [['compaction:child-ada', 1]], [['compaction:child-ada', 1]],
    ])
    // The provider's fact with numbers, then the core's fact that the CLI reported nothing.
    expect(views[0]![0]!.compaction?.member).toMatchObject({ source: 'manual', beforeTokens: 500_000, afterTokens: 40_000 })
    expect(views[1]![0]!.compaction?.member).toMatchObject({ source: 'manual', unrecorded: ['usage', 'before-after', 'summary'] })
    // Nothing is left unattributed: every compaction sits in an execution a round claims.
    expect(store.getTurn('s', ROOM_UNATTRIBUTED_TURN)).toBeUndefined()
    expect(fixture.compactCases.length).toBeGreaterThan(0)
    for (const { text, compact } of fixture.compactCases) expect([text, isCompactCommand(text)]).toEqual([text, compact])
  })

  it('a report-timing call names the run and task it decided for: it lands on the round that started the task, never by time', () => {
    const store = loaded()
    const decision = rows.find(row => row.type === 'room/decision' && data(row)['call'] !== undefined && data(row)['scenario'] === 'report-timing')!
    const d = data(decision)
    // S9 fields as room writes them.
    expect(d).toMatchObject({ runId: expect.any(String), task: expect.any(String), executionId: expect.any(String) })
    const third = roundOf(store, '第三轮')
    expect(third.room?.messageId).toBe(d['task'])
    expect(third.roomDecisionIds).toEqual([d['id']])
    expect(store.getTurn('s', third.turnSeq)!.roomDecisions).toMatchObject([{ id: d['id'], scenario: 'report-timing', runId: d['runId'], task: d['task'] }])
    // A rule decision carries no call: no request anywhere.
    const rule = rows.find(row => row.type === 'room/decision' && data(row)['call'] === undefined)!
    expect(store.listTurns('s').turns.some(turn => turn.roomDecisionIds?.includes(data(rule)['id'] as string) === true)).toBe(false)
  })

  it('a help thread names the asker\'s task', () => {
    const help = rows.find(row => row.type === 'room/help')!
    expect(data(help)['task']).toBe(userMessageId('@bea 第三轮'))
  })
})
