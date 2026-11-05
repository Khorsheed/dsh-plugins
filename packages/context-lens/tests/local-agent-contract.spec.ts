/**
 * local-agent → Context Lens contract: replay a member child log that the
 * local-agent core REALLY wrote (fixtures/local-agent-contract.json,
 * generated and kept fresh by local-agent's `tests/lens-contract.spec.ts`)
 * through lens's own fold. The log carries execution records, so lens reads
 * them as facts: one `assistant/message` is one request (no stitching of
 * usage-less steps), a request's start is what the log recorded (no
 * previous-event substitute), a between-turns compaction belongs to the
 * execution its records bracket (no "last closed turn"), and what the source
 * does not report is shown as such. Lens keeps no dependency on local-agent.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { foldLogRows, openCursor, reconstructSession, type ExecutionRecord, type SessionLogRow } from '../src/log-lane.ts'
import { ROOM_UNATTRIBUTED_TURN } from '../src/room.ts'
import { InspectorStore } from '../src/store.ts'

interface Fixture {
  readonly childSessionId: string
  readonly executions: { executionId: string; operation: string; turns: number[]; unrecorded: string[] }[]
  readonly rows: SessionLogRow[]
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/local-agent-contract.json', import.meta.url), 'utf8')) as Fixture
const [live, exec, compact] = fixture.executions
const child = fixture.childSessionId
const rowOf = (seq: number): SessionLogRow => fixture.rows.find(row => row.seq === seq)!

function fold() {
  const records: ExecutionRecord[] = []
  const built = foldLogRows(openCursor(), fixture.rows, { execution: record => records.push(record) })
  return { built, records, requests: built.filter(request => request.purpose === undefined), compactions: built.filter(request => request.purpose === 'compaction') }
}

describe('local-agent → Context Lens contract (fixture from the core\'s writers)', () => {
  it('the fixture holds a live round, a codex-exec round and a /compact, as the core recorded them', () => {
    expect(fixture.executions.map(e => [e.operation, e.turns, e.unrecorded])).toEqual([
      ['prompt', [1], ['internal-calls']],
      ['prompt', [2], ['call-boundaries', 'per-call-usage', 'internal-calls']],
      ['compact', [], ['compaction']],
    ])
    const { records } = fold()
    expect(records.map(record => [record.phase, record.executionId])).toEqual([
      ['start', live!.executionId], ['end', live!.executionId],
      ['start', exec!.executionId], ['end', exec!.executionId],
      ['start', compact!.executionId], ['end', compact!.executionId],
    ])
    expect(records[0]).toMatchObject({ phase: 'start', operation: 'prompt', cause: { kind: 'human', via: 'room' }, task: { id: expect.any(String) } })
    expect(records[3]).toMatchObject({ phase: 'end', turns: [2], unrecorded: exec!.unrecorded })
  })

  it('one assistant/message is one request, each in the execution its records bracket', () => {
    const { requests } = fold()
    expect(requests.map(request => [request.hostTurn, request.executionId, request.usage?.inputTokens])).toEqual([
      [1, live!.executionId, 1000],
      [1, live!.executionId, 1200],
      // Codex exec: no call boundaries are recorded, so none are made up —
      // but its two text-only steps with neither usage nor a logged stream
      // are mirror annotations (history), in every lens path alike.
      [2, exec!.executionId, 900],
    ])
  })

  it('a per-call-usage execution\'s usage reads as the round\'s total', () => {
    const { requests } = fold()
    expect(requests.map(request => request.roundTotal === true)).toEqual([false, false, true])
  })

  it('no recorded dispatch time: a request starts when its step was written, marked unrecorded (never the previous event)', () => {
    const { requests } = fold()
    expect(requests[0]!.startedAt).toBe(rowOf(3).time)
    expect(requests.every(request => request.startUnrecorded === true)).toBe(true)
  })

  it('compactions carry their execution and what the source did not report', () => {
    const { compactions } = fold()
    expect(compactions.map(request => [request.executionId, request.hostTurn, request.compaction?.source, request.compaction?.unrecorded, request.compaction?.betweenTurns])).toEqual([
      // Codex's own compaction inside turn 1: that turn, its usage not reported.
      [live!.executionId, 1, 'auto', ['usage'], undefined],
      // The core's fact for a /compact the CLI reports nothing about: no turn, its own execution.
      [compact!.executionId, undefined, 'manual', ['usage', 'before-after', 'summary'], true],
    ])
    expect(compactions[1]!.usage).toBeUndefined()
  })

  it('the same log without its records folds the legacy way (old logs keep their reading)', () => {
    const legacy = foldLogRows(openCursor(), fixture.rows.filter(row => row.type !== 'local-agent/execution')).filter(request => request.purpose === undefined)
    // Usage-less text-only steps are annotations here too; the round reads as one request.
    expect(legacy.map(request => [request.hostTurn, request.usage?.inputTokens])).toEqual([[1, 1000], [1, 1200], [2, 900]])
  })

  it('in the member\'s own lens, text-only steps with neither stream nor usage stay mirror annotations, as before', () => {
    // A step that logged no stream and carries no usage is history, not a
    // model request — the same rule as the live fold above.
    const turns = reconstructSession(fixture.rows)
    const real = turns.filter(turn => turn.hostTurn > 0)
    expect(real.map(turn => [turn.hostTurn, turn.requests.length])).toEqual([[1, 2], [2, 1]])
    expect(real[1]!.requests[0]).toMatchObject({ roundTotal: true, usage: { inputTokens: 900 } })
    expect(turns.filter(turn => turn.purpose === 'compaction')).toHaveLength(2)
  })

  it('in a room: each round shows what its execution brackets — the prompt round its requests and auto compaction, the /compact round the core\'s fact', () => {
    const store = new InspectorStore()
    const room: SessionLogRow[] = [
      { type: 'room/member-added', seq: 1, time: 1, data: { id: 'm-ada', name: 'ada' } },
      { type: 'room/dispatch', seq: 5, time: 1_800_000_000_050, data: { origin: 'human', text: '看一下', targets: ['ada'], messageId: 'u-5' } },
      { type: 'subagent/catalog', seq: 6, time: 1_800_000_000_055, data: { childId: child, mode: 'session', label: 'Fake' } },
      { type: 'room/run-state', seq: 7, time: 1_800_000_000_060, data: { runId: '5:m-ada', member: 'ada', state: 'running', startedAt: 1_800_000_000_060, childSessionId: child, executionId: live!.executionId } },
      { type: 'room/run-state', seq: 8, time: 1_800_000_000_200, data: { runId: '5:m-ada', member: 'ada', state: 'done', startedAt: 1_800_000_000_060, elapsedMs: 140, childSessionId: child, executionId: live!.executionId, childTurn: 1 } },
      { type: 'room/dispatch', seq: 12, time: 1_800_000_000_560, data: { origin: 'human', text: '/compact', targets: ['ada'] } },
      { type: 'room/run-state', seq: 13, time: 1_800_000_000_620, data: { runId: '12:m-ada', member: 'ada', state: 'done', operation: 'compact', startedAt: 1_800_000_000_570, elapsedMs: 50, childSessionId: child, executionId: compact!.executionId } },
    ]
    store.insertLogTurns('s', reconstructSession(room))
    for (const row of room) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    for (const request of foldLogRows(openCursor(), fixture.rows, { execution: record => store.noteExecution(child, record) })) store.appendLogRequest('s', child, request)
    const list = store.listTurns('s')
    expect(list.roomRecords).toBe('some')
    const round = list.turns.find(turn => turn.query === '看一下')!
    const scopes = store.getTurn('s', round.turnSeq)!.scopes
    expect(scopes.map(scope => [scope.kind, scope.requests.length])).toEqual([['subagent', 2], ['compaction', 1]])
    expect(scopes[0]!.execution).toEqual({ executionId: live!.executionId, cause: 'human', outcome: 'done', unrecorded: ['internal-calls'] })
    expect(scopes[0]!.requests.every(request => request.startUnrecorded === true)).toBe(true)
    const compactRound = list.turns.find(turn => turn.query === '/compact')!
    expect(store.getTurn('s', compactRound.turnSeq)!.scopes.map(scope => [scope.scopeId, scope.requests.length, scope.compaction?.member?.unrecorded])).toEqual([
      [`compaction:${child}`, 1, ['usage', 'before-after', 'summary']],
    ])
    // The codex-exec execution no room round claims holds no compaction, so nothing is unattributed.
    expect(store.getTurn('s', ROOM_UNATTRIBUTED_TURN)).toBeUndefined()
  })
})
