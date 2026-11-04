/**
 * Room → Context Lens contract: replay the room log that room's REAL writers
 * produced (fixtures/room-contract.json, generated and kept fresh by room's
 * `tests/lens-contract.host.spec.ts`) through lens's own parsers, and check
 * the lens view of each fact room writes. Lens keeps no dependency on room;
 * the fixture is the only coupling.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { reconstructSession, type BuiltLogRequest, type SessionLogRow } from '../src/log-lane.ts'
import { applyRoomEvent, emptyRoom, isCompactCommand, type RoomState } from '../src/room.ts'
import { InspectorStore } from '../src/store.ts'

interface Fixture {
  readonly roomRows: SessionLogRow[]
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
  // The member's own requests, one per round the room recorded (childTurn 1–4).
  for (const row of runStates) {
    const d = data(row)
    if (typeof d['childTurn'] === 'number') store.appendLogRequest('s', 'child-ada', childRequest((d['startedAt'] as number) + 5, d['childTurn']))
  }
  return store
}

describe('room → Context Lens contract (fixture from room\'s writers)', () => {
  it('each human dispatch outside a main turn is a round anchored on the human\'s own message; /compact and relay deliveries are not rounds', () => {
    const turns = loaded().listTurns('s').turns
    expect(turns.map(turn => turn.query)).toEqual(['搭骨架', '第二轮', '长任务'])
    expect(turns.map(turn => turn.room?.messageId)).toEqual([undefined, userMessageId('@ada 第二轮'), userMessageId('@bea 长任务')])
  })

  it('a round holds its own run: child, state, and the child turn the room recorded', () => {
    const store = loaded()
    const [first, second, third] = store.listTurns('s').turns
    // The member's requests stand at each run's start + 5 ms; a round shows only its run's (by its childTurn).
    const at = (runId: string): number => (runState(runId, 'running')['startedAt'] as number) + 5
    expect(store.getTurn('s', first!.turnSeq)!.scopes.map(scope => [scope.scopeId, scope.status, scope.requests.map(request => request.startedAt)]))
      .toEqual([['child-ada', 'ok', [at(`3:${ada}`)]]])
    expect(store.getTurn('s', second!.turnSeq)!.scopes[0]?.requests.map(request => request.startedAt)).toEqual([at(`11:${ada}`)])
    // The stopped round: cancelled, ended at startedAt + elapsedMs as room wrote them.
    const cancelled = runState(`19:${ada}`, 'cancelled')
    const scope = store.getTurn('s', third!.turnSeq)!.scopes[0]!
    expect([scope.status, scope.startedAt, scope.endedAt, scope.requests.map(request => request.startedAt)])
      .toEqual(['cancelled', cancelled['startedAt'], (cancelled['startedAt'] as number) + (cancelled['elapsedMs'] as number), [at(`19:${ada}`)]])
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

  it('a compaction run claims no child turn, and the lens /compact mirror judges every case as the core', () => {
    const compactRun = runStates.find(row => data(row)['operation'] === 'compact' && data(row)['state'] === 'done')!
    expect(data(compactRun)['childTurn']).toBeUndefined()
    // Batch 5 S6: room no longer copies the compaction's numbers; they stay on
    // the member log's `local-agent/compaction` fact (the one lens reads).
    expect(rows.some(row => row.type === 'room/member-compacted')).toBe(true)
    expect(rows.some(row => row.type === 'room/member-compacted' && 'beforeTokens' in data(row))).toBe(false)
    expect(fixture.compactCases.length).toBeGreaterThan(0)
    for (const { text, compact } of fixture.compactCases) expect([text, isCompactCommand(text)]).toEqual([text, compact])
  })
})
