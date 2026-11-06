/**
 * Rounds a member's CLI opens on its own when a background task ends
 * (local-agent cause `self`, design member-self-started-rounds M8), and turn
 * titles without the room's injected preambles.
 *
 * - Room lens: a self round shows under the room round whose run started the
 *   task (followed through `startedBy`, never by time), as its own tab beside
 *   the member; its requests count toward the round. A chain no round claims
 *   lands in 未归轮.
 * - Member lens: the self round stays its own turn; it says why it ran and
 *   where the task was started.
 *
 * Synthetic data shaped like a real Kimi member's log (no real content).
 */
import { describe, expect, it } from 'vitest'
import { readExecutionRecord, reconstructSession, type BuiltLogRequest, type SessionLogRow } from '../src/log-lane.ts'
import { stripRoomPreamble } from '../src/messages.ts'
import { zh } from '../src/client/locales.ts'
import { continuesText, selfRoundLabel } from '../src/client/RoomRecords.tsx'
import { ROOM_UNATTRIBUTED_TURN } from '../src/room.ts'
import { InspectorStore } from '../src/store.ts'

const HANDOFF = '你现在是本房间的协调者。\n【协调者交接】房间 把协调者交给了你（kimi）。从现在起，人发的不带 @ 的消息都由你来接。\n房间会话：s。各成员之前的原生会话都还在，可按会话 ID 查看；完整状态用 room_read。\n之前的对话没有附上：需要时用 room_read，或打开房间会话自己看。'
const BRIEF = '【房间简报】\n你是协作间成员「kimi」。\n其他成员：\n- coco（codex）\n联系成员、派活用 member_message。'

describe('stripRoomPreamble', () => {
  it('drops the room\'s injected sections in front of the human\'s words', () => {
    expect(stripRoomPreamble(`${HANDOFF}\n\n把插件部署到 3080`)).toBe('把插件部署到 3080')
    expect(stripRoomPreamble(`${BRIEF}\n\n${HANDOFF.split('\n').slice(1).join('\n')}\n\n【房间变动】\n- coco 加入\n\n【通知】\n- coco 给你的通知: 好了\n\n开始吧`)).toBe('开始吧')
    expect(stripRoomPreamble('【#m12 的回报 · 来自 coco · 完成】（这条回复用户已在房间里看到，不要复述）\n做完了\n\n下一步做什么')).toBe('下一步做什么')
    expect(stripRoomPreamble('<system-reminder>\nauto mode\n</system-reminder>\n你好')).toBe('你好')
  })

  it('keeps the message when it is all preamble, when nothing is preamble, and keeps paragraphs of the human\'s own text', () => {
    expect(stripRoomPreamble(BRIEF)).toBe(BRIEF)
    expect(stripRoomPreamble('【#m12 的回报 · 来自 coco · 完成】\n做完了')).toBe('【#m12 的回报 · 来自 coco · 完成】\n做完了')
    expect(stripRoomPreamble('第一段\n\n第二段')).toBe('第一段\n\n第二段')
    expect(stripRoomPreamble(`${HANDOFF}\n\n第一段\n\n【通知】不是开头`)).toBe('第一段\n\n【通知】不是开头')
    // A member dispatch's envelope is the message's own head, not a preamble.
    expect(stripRoomPreamble('【来自 coco · #m3】\n看一下日志')).toBe('【来自 coco · #m3】\n看一下日志')
  })
})

// ---------- the room's lens ----------

const roomRows: SessionLogRow[] = [
  { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
  { type: 'user/message', seq: 1, time: 10, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: '邀请 kimi' }], source: { kind: 'user' } } },
  { type: 'turn/end', seq: 2, time: 20, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'room/member-added', seq: 5, time: 500, data: { id: 'm-kimi', name: 'kimi' } },
  { type: 'room/coordinator', seq: 6, time: 600, data: { memberId: 'm-kimi', previousMemberId: 'main' } },
  // The dispatch whose run starts the background task.
  { type: 'room/dispatch', seq: 181, time: 10_000, data: { origin: 'human', text: '把插件部署到 3080', targets: ['kimi'], targetIds: ['m-kimi'], messageId: 'u-181' } },
  { type: 'room/run-state', seq: 182, time: 10_050, data: { runId: '181:m-kimi', member: 'kimi', state: 'running', startedAt: 10_050, childSessionId: 'child-kimi', executionId: 'e-dispatch' } },
  { type: 'room/run-state', seq: 183, time: 20_050, data: { runId: '181:m-kimi', member: 'kimi', state: 'done', startedAt: 10_050, elapsedMs: 10_000, childSessionId: 'child-kimi', executionId: 'e-dispatch', childTurn: 2 } },
  // The room observed the self round as a run started elsewhere: no dispatch seq.
  { type: 'room/run-state', seq: 190, time: 40_000, data: { runId: 'execution:e-self', member: 'kimi', state: 'running', startedAt: 40_000, childSessionId: 'child-kimi', executionId: 'e-self' } },
  { type: 'room/run-state', seq: 191, time: 45_000, data: { runId: 'execution:e-self', member: 'kimi', state: 'done', startedAt: 40_000, elapsedMs: 5000, childSessionId: 'child-kimi', executionId: 'e-self' } },
  { type: 'subagent/catalog', seq: 192, time: 45_100, data: { childId: 'child-kimi', mode: 'session', label: 'Kimi' } },
]

const request = (startedAt: number, hostTurn: number, executionId: string, execs: BuiltLogRequest['execs'] = []): BuiltLogRequest => ({
  hostTurn, executionId,
  startedAt, settledAt: startedAt + 500, status: 'ok', config: { provider: 'kimi' },
  usage: { inputTokens: 1000, outputTokens: 50 },
  responseSummary: { kind: 'text' },
  segments: { system: [], tools: [], history: [], added: [] }, totalChars: 0,
  blocks: [], execs, fingerprint: { messageKeys: [], toolNames: [] },
})
const record = (data: Record<string, unknown>, at: number) => readExecutionRecord(data, at)!
const selfCause = (taskId: string, startedBy?: string, taskStatus = 'completed') =>
  ({ kind: 'self', reason: 'background-task', taskId, taskStatus, notificationId: `task:${taskId}:${taskStatus}`, ...startedBy === undefined ? {} : { startedBy } })

/** The member's log as lens read it: the dispatch round (turn 2) starts bash-1 in its second call; turn 3 is the self round. */
function memberLog(store: InspectorStore, extra: (store: InspectorStore) => void = () => {}): void {
  store.noteExecution('child-kimi', record({ phase: 'start', executionId: 'e-dispatch', caller: 'room', operation: 'prompt', cause: { kind: 'human', dispatchSeq: 181 }, task: { sessionId: 's', id: 'u-181' } }, 10_060))
  store.appendLogRequest('s', 'child-kimi', request(11_000, 2, 'e-dispatch'))
  store.appendLogRequest('s', 'child-kimi', request(12_000, 2, 'e-dispatch', [{ callId: 'call-bg', name: 'Shell', start: 12_400, end: 12_450, result: 'Started background task bash-1' }]))
  store.appendLogRequest('s', 'child-kimi', request(13_000, 2, 'e-dispatch'))
  store.noteExecution('child-kimi', record({ phase: 'end', executionId: 'e-dispatch', outcome: 'done', turns: [2], unrecorded: ['internal-calls'] }, 20_000))
  store.noteExecution('child-kimi', record({ phase: 'start', executionId: 'e-self', caller: 'cli', operation: 'prompt', cause: selfCause('bash-1', 'e-dispatch'), task: { sessionId: 's', id: 'u-181' } }, 40_000))
  store.appendLogRequest('s', 'child-kimi', request(41_000, 3, 'e-self'))
  store.appendLogRequest('s', 'child-kimi', request(42_000, 3, 'e-self'))
  store.noteExecution('child-kimi', record({ phase: 'end', executionId: 'e-self', outcome: 'done', turns: [3], unrecorded: ['internal-calls'] }, 45_000))
  extra(store)
}

function load(extra?: (store: InspectorStore) => void): InspectorStore {
  const store = new InspectorStore()
  store.insertLogTurns('s', reconstructSession(roomRows))
  for (const row of roomRows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
  memberLog(store, extra)
  return store
}

describe('room lens: a self round under the round whose run started its task', () => {
  it('shows it as a tab beside the member, with its own requests and where the task was started', () => {
    const store = load()
    const round = store.listTurns('s').turns.find(turn => turn.room !== undefined)!
    const overview = store.getTurn('s', round.turnSeq)!
    expect(overview.scopes.map(scope => [scope.scopeId, scope.kind, scope.label, scope.status, scope.requests.map(r => r.startedAt)])).toEqual([
      ['child-kimi', 'subagent', 'kimi', 'ok', [11_000, 12_000, 13_000]],
      ['self:e-self', 'subagent', 'kimi', 'ok', [41_000, 42_000]],
    ])
    const self = overview.scopes[1]!
    const starter = overview.scopes[0]!.requests[1]!
    expect(self.continues).toEqual({ taskId: 'bash-1', taskStatus: 'completed', startedBy: { turnSeq: round.turnSeq, scopeId: 'child-kimi', seq: starter.seq, viaTask: true } })
    expect(self.execution).toEqual({ executionId: 'e-self', cause: 'self', taskStatus: 'completed', outcome: 'done', unrecorded: ['internal-calls'] })
    // Its requests count toward the round: the row's totals and the session map's bars.
    expect(round.requestCount).toBe(5)
    expect(round.endedAt).toBe(45_000)
    expect(store.getSessionTrend('s').requests.filter(r => r.turnSeq === round.turnSeq).map(r => r.scopeId)).toEqual(['child-kimi', 'child-kimi', 'child-kimi', 'self:e-self', 'self:e-self'])
    // Claimed by the round: not in 未归轮.
    expect(store.listTurns('s').turns.some(turn => turn.roomUnattributed === true)).toBe(false)
    // The round's timing view holds the self round's lane too.
    expect(new Set(store.getTurnTiming('s', round.turnSeq)?.lanes.map(lane => lane.scopeId))).toContain('self:e-self')
  })

  it('follows a chain through another self round; several of one member are numbered', () => {
    const store = load(s => {
      s.noteExecution('child-kimi', record({ phase: 'start', executionId: 'e-self-2', caller: 'cli', operation: 'prompt', cause: selfCause('bash-2', 'e-self', 'failed') }, 50_000))
      s.appendLogRequest('s', 'child-kimi', request(51_000, 4, 'e-self-2'))
      s.noteExecution('child-kimi', record({ phase: 'end', executionId: 'e-self-2', outcome: 'done', turns: [4], unrecorded: [] }, 52_000))
    })
    const round = store.listTurns('s').turns.find(turn => turn.room !== undefined)!
    const scopes = store.getTurn('s', round.turnSeq)!.scopes
    expect(scopes.map(scope => [scope.scopeId, scope.continues?.index, scope.continues?.taskStatus])).toEqual([
      ['child-kimi', undefined, undefined],
      ['self:e-self', 1, 'completed'],
      ['self:e-self-2', 2, 'failed'],
    ])
    // bash-2 is named by no tool result: the starting round's first request, said as such.
    expect(scopes[2]!.continues?.startedBy).toMatchObject({ scopeId: 'self:e-self', seq: scopes[1]!.requests[0]!.seq, viaTask: false })
  })

  it('a chain no round claims lands in 未归轮, never in a round by time', () => {
    const store = load(s => {
      // Started by a members-page round the room has no round for, and one with no startedBy at all.
      s.noteExecution('child-kimi', record({ phase: 'start', executionId: 'e-page', caller: 'composer', operation: 'prompt', cause: { kind: 'human' } }, 60_000))
      s.appendLogRequest('s', 'child-kimi', request(60_500, 5, 'e-page'))
      s.noteExecution('child-kimi', record({ phase: 'end', executionId: 'e-page', outcome: 'done', turns: [5], unrecorded: [] }, 61_000))
      s.noteExecution('child-kimi', record({ phase: 'start', executionId: 'e-loose', caller: 'cli', operation: 'prompt', cause: selfCause('bash-3', 'e-page') }, 70_000))
      s.appendLogRequest('s', 'child-kimi', request(70_500, 6, 'e-loose'))
      s.noteExecution('child-kimi', record({ phase: 'end', executionId: 'e-loose', outcome: 'done', turns: [6], unrecorded: [] }, 71_000))
      s.noteExecution('child-kimi', record({ phase: 'start', executionId: 'e-unlinked', caller: 'cli', operation: 'prompt', cause: selfCause('bash-4') }, 80_000))
      s.appendLogRequest('s', 'child-kimi', request(80_500, 7, 'e-unlinked'))
    })
    const list = store.listTurns('s')
    const round = list.turns.find(turn => turn.room !== undefined)!
    expect(store.getTurn('s', round.turnSeq)!.scopes.map(scope => scope.scopeId)).toEqual(['child-kimi', 'self:e-self'])
    expect(list.turns.at(-1)).toMatchObject({ turnSeq: ROOM_UNATTRIBUTED_TURN, roomUnattributed: true })
    const loose = store.getTurn('s', ROOM_UNATTRIBUTED_TURN)!.scopes
    expect(loose.map(scope => [scope.scopeId, scope.status, scope.requests.map(r => r.startedAt), scope.continues?.startedBy])).toEqual([
      ['self:e-loose', 'ok', [70_500], undefined],
      ['self:e-unlinked', 'running', [80_500], undefined],
    ])
  })

  it('a self round in an unrecorded round adds nothing: that round keeps its fallback', () => {
    const rows = roomRows.map(row => row.type === 'room/run-state' && (row.data as { runId?: string }).runId === '181:m-kimi'
      ? { ...row, data: { ...row.data as Record<string, unknown>, executionId: undefined, childTurn: undefined } } : row)
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(rows))
    for (const row of rows) if (row.type.startsWith('room/')) store.noteRoomEvent('s', row.type, row.data, row.seq, row.time)
    memberLog(store)
    const round = store.listTurns('s').turns.find(turn => turn.room !== undefined)!
    expect(round.room?.unrecorded).toBe(true)
    expect(store.getTurn('s', round.turnSeq)!.scopes).toEqual([])
  })
})

// ---------- the member's own lens ----------

/** A Kimi member's own log: turn 2 the dispatch (handoff preamble in front of the human's words) starting bash-1; turn 3 the self round. */
const memberRows: SessionLogRow[] = [
  { type: 'local-agent/execution', seq: 0, time: 10_000, data: { phase: 'start', executionId: 'e-dispatch', caller: 'room', operation: 'prompt', cause: { kind: 'human', dispatchSeq: 181 } } },
  { type: 'turn/start', seq: 1, time: 10_010, data: { turn: 2 } },
  { type: 'user/message', seq: 2, time: 10_020, surfaceOp: 'append', data: { id: 'u2', role: 'user', content: [{ type: 'text', text: `${HANDOFF}\n\n把插件部署到 3080` }], source: { kind: 'user' } } },
  { type: 'step/start', seq: 3, time: 11_000, data: { turn: 2, step: 1 } },
  { type: 'assistant/message', seq: 4, time: 11_500, surfaceOp: 'append', data: { turn: 2, step: 1, usage: { inputTokens: 900, outputTokens: 30 }, message: { id: 'a4', role: 'assistant', content: [{ type: 'tool-call', id: 'call-bg', name: 'Shell', arguments: '{"command":"pnpm deploy:3080","run_in_background":true}' }] } } },
  { type: 'tool/call', seq: 4.5, time: 11_550, data: { turn: 2, step: 1, callId: 'call-bg', name: 'Shell', arguments: '{"command":"pnpm deploy:3080","run_in_background":true}' } },
  { type: 'tool/result', seq: 5, time: 11_600, surfaceOp: 'append', data: { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'call-bg', content: [{ type: 'text', text: 'Started background task bash-1' }] } } },
  { type: 'step/end', seq: 6, time: 11_700, data: { turn: 2, step: 1 } },
  { type: 'step/start', seq: 7, time: 12_000, data: { turn: 2, step: 2 } },
  { type: 'assistant/message', seq: 8, time: 12_500, surfaceOp: 'append', data: { turn: 2, step: 2, usage: { inputTokens: 1000, outputTokens: 40 }, message: { id: 'a8', role: 'assistant', content: [{ type: 'text', text: '已在后台部署，完成后我会继续汇报' }] } } },
  { type: 'step/end', seq: 9, time: 12_600, data: { turn: 2, step: 2 } },
  { type: 'turn/end', seq: 10, time: 12_700, data: { turn: 2, reason: { kind: 'completed' } } },
  { type: 'local-agent/execution', seq: 11, time: 12_800, data: { phase: 'end', executionId: 'e-dispatch', outcome: 'done', turns: [2], unrecorded: ['internal-calls'] } },
  { type: 'local-agent/execution', seq: 12, time: 40_000, data: { phase: 'start', executionId: 'e-self', caller: 'cli', operation: 'prompt', cause: selfCause('bash-1', 'e-dispatch'), task: { sessionId: 's', id: 'u-181' } } },
  { type: 'turn/start', seq: 13, time: 40_010, data: { turn: 3 } },
  { type: 'step/start', seq: 14, time: 41_000, data: { turn: 3, step: 1 } },
  { type: 'assistant/message', seq: 15, time: 41_500, surfaceOp: 'append', data: { turn: 3, step: 1, usage: { inputTokens: 1100, outputTokens: 60 }, message: { id: 'a15', role: 'assistant', content: [{ type: 'text', text: '部署完成' }] } } },
  { type: 'step/end', seq: 16, time: 41_600, data: { turn: 3, step: 1 } },
  { type: 'turn/end', seq: 17, time: 41_700, data: { turn: 3, reason: { kind: 'completed' } } },
  { type: 'local-agent/execution', seq: 18, time: 41_800, data: { phase: 'end', executionId: 'e-self', outcome: 'done', turns: [3], unrecorded: ['internal-calls'] } },
]

describe('member lens: the self round is its own turn and says why it ran', () => {
  it('titles the dispatch turn with the human\'s words and marks the self turn with its task and starting request', () => {
    const store = new InspectorStore()
    store.insertLogTurns('m', reconstructSession(memberRows))
    const turns = store.listTurns('m').turns
    expect(turns.map(turn => [turn.hostTurn, turn.query, turn.continues?.taskId])).toEqual([
      [2, '把插件部署到 3080', undefined],
      [3, '', 'bash-1'],
    ])
    const starter = store.getTurn('m', 2)!.scopes[0]!.requests[0]!
    expect(turns[1]!.continues).toEqual({ taskId: 'bash-1', taskStatus: 'completed', startedBy: { turnSeq: 2, scopeId: 'main', seq: starter.seq, ...starter.requestNumber === undefined ? {} : { requestNumber: starter.requestNumber }, viaTask: true } })
    // The turn's main view carries the same facts (the tabs row's jump reads them).
    expect(store.getTurn('m', 3)!.scopes[0]!.continues).toEqual(turns[1]!.continues)
    expect(store.getTurn('m', 2)!.scopes[0]!.continues).toBeUndefined()
  })

  it('without startedBy the turn still says it continued after the task, with no jump', () => {
    const rows = memberRows.map(row => row.seq === 12 ? { ...row, data: { ...row.data as Record<string, unknown>, cause: selfCause('bash-1', undefined, 'timed_out') } } : row)
    const store = new InspectorStore()
    store.insertLogTurns('m', reconstructSession(rows))
    expect(store.listTurns('m').turns[1]!.continues).toEqual({ taskId: 'bash-1', taskStatus: 'timed_out' })
  })
})

describe('the self round\'s words', () => {
  const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
    zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as Parameters<typeof continuesText>[1]
  it('names the tab after its member and how the task ended, numbered only among several', () => {
    expect(selfRoundLabel({ scopeId: 'self:e', label: 'kimi', continues: { taskId: 'b', taskStatus: 'completed' } }, t)).toBe('kimi · 后台任务完成后继续')
    expect(selfRoundLabel({ scopeId: 'self:e', label: 'kimi', continues: { taskId: 'b', taskStatus: 'timed_out', index: 2 } }, t)).toBe('kimi · 后台任务超时后继续 2')
    expect(continuesText('failed', t)).toBe('后台任务失败后继续')
    expect(continuesText('lost', t)).toBe('后台任务结束后继续')
  })
})
