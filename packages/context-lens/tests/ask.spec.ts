/**
 * `ask_user_question` read as questions and answers: from the call's own
 * arguments, else the room's `room/question` record (member mirrors before
 * 10-27 22:00 dropped nested arguments), matched by runId, else by member,
 * answers and time; every failure shape seen in prod; the room's wait time.
 */
import { describe, expect, it } from 'vitest'
import { askView, isAskTool, readFailure } from '../src/ask.ts'
import { InspectorStore } from '../src/store.ts'
import { reconstructSession, type BuiltLogRequest, type SessionLogRow } from '../src/log-lane.ts'

const questions = [{ id: 'style', header: '美术方向', question: '整体风格往哪走？', options: [{ label: '水墨绘本（推荐）', description: '线条清楚' }, { label: '写实' }] }]
const answered = JSON.stringify({ answers: [{ id: 'style', selected: ['水墨绘本（推荐）'] }] })

describe('ask view', () => {
  it('recognizes the tool bare and behind an MCP prefix', () => {
    expect(isAskTool('ask_user_question')).toBe(true)
    expect(isAskTool('mcp__dsh-member__ask_user_question')).toBe(true)
    expect(isAskTool('ask_user')).toBe(false)
  })

  it('reads questions from the arguments and answers from the result, with the call span', () => {
    const view = askView({ arguments: JSON.stringify({ questions }), execution: { running: false, start: 1000, end: 14300, result: answered } })
    expect(view).toMatchObject({ outcome: 'answered', source: 'arguments', waitMs: 13300, answers: [{ id: 'style', selected: ['水墨绘本（推荐）'] }] })
    expect(view.questions?.[0]).toMatchObject({ header: '美术方向', options: [{ label: '水墨绘本（推荐）', description: '线条清楚' }, { label: '写实' }] })
  })

  it('takes questions and the asked → answered wait from the room when the call lost its arguments', () => {
    const room = { id: 'q', questions: askViewQuestions(), askedAt: 1000, resolvedAt: 13900, outcome: 'answered' as const, answers: [{ id: 'style', selected: ['写实'], custom: '再粗糙一点' }] }
    const view = askView({ arguments: '', execution: { running: false, start: 20000, end: 20000, result: answered }, room })
    expect(view).toMatchObject({ source: 'room', waitMs: 12900, answers: [{ id: 'style', selected: ['写实'], custom: '再粗糙一点' }] })
  })

  it('a room question cancelled and never answered reads expired; answered late reads late', () => {
    const base = { id: 'q', questions: askViewQuestions(), askedAt: 0 }
    expect(askView({ arguments: '', execution: { running: false, result: 'Tool "x" failed: MCP error -32001: Request timed out' }, room: { ...base, outcome: 'cancelled' } }).outcome).toBe('expired')
    expect(askView({ arguments: '', room: { ...base, outcome: 'answered', late: true, resolvedAt: 60000, answers: [{ id: 'style', selected: ['写实'] }] } }))
      .toMatchObject({ outcome: 'answered', late: true, waitMs: 60000 })
  })

  it('keeps the room\'s answer and notes the call itself timed out first (kimi waited 60 s, the human answered at 133 s)', () => {
    const room = { id: 'q', questions: askViewQuestions(), askedAt: 0, resolvedAt: 133000, outcome: 'answered' as const, answers: [{ id: 'style', selected: ['写实'] }] }
    const view = askView({ arguments: '', execution: { running: false, result: 'Tool "x" failed: MCP error -32001: Request timed out' }, room })
    expect(view).toMatchObject({ outcome: 'answered', waitMs: 133000, callOutcome: 'timeout' })
  })

  it('reads every failure shape seen in prod', () => {
    expect(readFailure('Tool "mcp__dsh-member__ask_user_question" failed: MCP error -32001: Request timed out')).toBe('timeout')
    expect(readFailure('Error: the user cancelled ask_user_question')).toBe('cancelled')
    expect(readFailure('Error: ask_user_question was aborted before the user answered')).toBe('aborted')
    expect(readFailure('问题已过期，人没有回答')).toBe('expired')
    expect(askView({ arguments: '{}', execution: { running: false, result: 'something odd' } })).toMatchObject({ outcome: 'failed', detail: 'something odd' })
  })
})

function askViewQuestions() { return questions.map(q => ({ ...q, options: [...q.options] })) }

describe('room question matching in the store', () => {
  const child = 'child-kimi'
  const room = (runId?: string): SessionLogRow[] => [
    { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 10, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'room/member-added', seq: 2, time: 20, data: { id: 'm-kimi', name: '人物建模大师' } },
    { type: 'room/dispatch', seq: 3, time: 1000, data: { origin: 'human', text: '继续', targets: ['人物建模大师'] } },
    { type: 'room/run-state', seq: 4, time: 1001, data: { runId: '3:m-kimi', member: '人物建模大师', state: 'done', startedAt: 1001, elapsedMs: 30000, childSessionId: child, childTurn: 2 } },
    { type: 'subagent/catalog', seq: 5, time: 1002, data: { childId: child, mode: 'session', label: 'Kimi' } },
    { type: 'room/question', seq: 6, time: 5000, data: { id: 'q1', member: '人物建模大师', memberId: 'm-kimi', ...runId === undefined ? {} : { runId }, questions } },
    { type: 'room/question-resolved', seq: 7, time: 17900, data: { id: 'q1', outcome: 'answered', answers: [{ id: 'style', selected: ['水墨绘本（推荐）'] }] } },
  ]
  const askRequest = (start: number): BuiltLogRequest => ({
    hostTurn: 2, startedAt: start, settledAt: start + 10, status: 'ok', config: { provider: 'kimi-cli' },
    responseSummary: { kind: 'tool', name: 'mcp__dsh-member__ask_user_question' },
    response: { toolCalls: [{ callId: 'c1', name: 'mcp__dsh-member__ask_user_question', arguments: '' }] },
    segments: { system: [], tools: [], history: [], added: [] }, totalChars: 0,
    blocks: [], execs: [{ callId: 'c1', name: 'mcp__dsh-member__ask_user_question', start: start + 10, end: start + 10, isError: false, result: answered }],
    fingerprint: { messageKeys: [], toolNames: [] },
  })
  const load = (rows: SessionLogRow[], start: number) => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(rows))
    for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    const appended = store.appendLogRequest('s', child, askRequest(start))!
    const view = store.getRequest('s', appended.seq)
    if (view === undefined || 'refused' in view) throw new Error('missing')
    return view.response!.toolCalls[0]!.ask!
  }

  it('matches by runId: the run\'s child session and turn', () => {
    expect(load(room('3:m-kimi'), 22000)).toMatchObject({ source: 'room', outcome: 'answered', waitMs: 12900 })
  })

  it('falls back to member, answers and time for a record without runId', () => {
    expect(load(room(), 22000)).toMatchObject({ source: 'room', waitMs: 12900 })
  })

  it('never takes a runId record whose run cannot confirm the turn and sits hours away (2e44: 13:30 call vs 21:13 question)', () => {
    const rows = room()
    rows.push({ type: 'room/run-state', seq: 8, time: 30_000_000, data: { runId: '9:m-kimi', member: '人物建模大师', state: 'cancelled', startedAt: 30_000_000, childSessionId: child } })
    rows.push({ type: 'room/question', seq: 9, time: 30_000_100, data: { id: 'late-q', member: '人物建模大师', memberId: 'm-kimi', runId: '9:m-kimi', questions } })
    rows.push({ type: 'room/question-resolved', seq: 10, time: 30_100_000, data: { id: 'late-q', outcome: 'cancelled' } })
    expect(load(rows, 22000)).toMatchObject({ outcome: 'answered', waitMs: 12900 })
  })

  it('leaves a call far from any record of its member unmatched', () => {
    expect(load(room(), 22000 + 3_600_000)).toMatchObject({ outcome: 'answered' })
    expect(load(room(), 22000 + 3_600_000).source).toBeUndefined()
  })
})
