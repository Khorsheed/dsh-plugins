/**
 * One turn's views beside the main conversation: compactions attach to the
 * turn they happened in (and every link to them follows), catalog-only
 * children (external agents no tool call started) become views on backfill,
 * a child's descriptor provider marks it external, main requests list the
 * child views their tool calls started, and a compaction replays the system
 * head and tools the host actually sent.
 */
import { describe, expect, it } from 'vitest'
import { foldLogRows, openCursor, reconstructSession, type SessionLogRow } from '../src/log-lane.ts'
import { InspectorStore } from '../src/store.ts'

const sys = (seq: number, id: string, text: string): SessionLogRow => ({ type: 'system/message', seq, time: seq * 100, surfaceOp: 'append', data: { turn: 1, message: { id, role: 'system', content: [{ type: 'text', text }], source: { kind: 'system-prompt' } } } })
const user = (seq: number, id: string, text: string, op: SessionLogRow['surfaceOp'] = 'append'): SessionLogRow => ({ type: 'user/message', seq, time: seq * 100, surfaceOp: op, data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
const answer = (seq: number, turn: number, calls: { id: string; name: string }[] = []): SessionLogRow => ({ type: 'assistant/message', seq, time: seq * 100, surfaceOp: 'append', data: { turn, message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...calls.map(c => ({ type: 'tool-call', id: c.id, name: c.name, arguments: '{"description":"查资料"}' }))] } } })
const header: SessionLogRow = { type: 'request/header', seq: 1, time: 100, data: { header: { config: { provider: 'deepseek', model: 'flash' }, tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }] } } }

function log(): SessionLogRow[] {
  return [
    { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
    header,
    sys(2, 'head', 'You are a coach.'),
    user(3, 'u1', 'hello'), answer(4, 1, [{ id: 'call-1', name: 'subagent_dsh' }]),
    { type: 'tool/call', seq: 5, time: 500, data: { turn: 1, callId: 'call-1', name: 'subagent_dsh', arguments: '{"description":"查资料"}' } },
    { type: 'subagent/catalog', seq: 6, time: 600, data: { childId: 'child-dsh', mode: 'one-shot', label: 'dsh: 查资料' } },
    { type: 'subagent/catalog', seq: 7, time: 700, data: { childId: 'child-codex', mode: 'one-shot', label: 'Codex' } },
    { type: 'tool/result', seq: 8, time: 800, surfaceOp: 'append', data: { turn: 1, message: { id: 'r1', role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'done' }] } } },
    answer(9, 1),
    { type: 'turn/end', seq: 10, time: 1000, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 11, time: 1100, data: { turn: 2 } },
    user(12, 'u2', 'next'),
    { type: 'compaction/start', seq: 13, time: 1300, data: { turn: 2, compactionId: 'c1' } },
    { type: 'compaction/summary', seq: 14, time: 1400, data: { compactionId: 'c1', shadowedSeqs: [3, 4], summary: [{ type: 'text', text: 'summary' }], provider: 'deepseek', model: 'flash', llmStreamCall: true, usage: { inputTokens: 50, outputTokens: 10 } } },
    { type: 'user/message', seq: 15, time: 1500, surfaceOp: { op: 'replace', startSeq: 3, endSeq: 4 }, data: { id: 'ck', role: 'user', content: [{ type: 'text', text: 'summary' }], source: { kind: 'compact-checkpoint', compactionId: 'c1' } } },
    { type: 'compaction/end', seq: 16, time: 1600, data: { compactionId: 'c1' } },
    answer(17, 2),
    { type: 'turn/end', seq: 18, time: 1800, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

describe('agent views', () => {
  it('replays a compaction with the system head and tools the host sent', () => {
    const compaction = foldLogRows(openCursor(), log()).find(r => r.purpose === 'compaction')!
    expect(compaction.segments.system.map(r => r.full)).toEqual(['You are a coach.'])
    expect(compaction.segments.tools.map(t => t.name)).toEqual(['read'])
    expect([...compaction.segments.history, ...compaction.segments.added].map(r => r.messageId)).toEqual(['u1', 'a4'])
    expect(compaction.compaction?.inputPartial).toBe(true)
  })

  it('surfaces a catalog-only child as a view without inventing a failure', () => {
    const turns = reconstructSession(log())
    expect(turns.find(t => t.hostTurn === 1)?.delegations.map(d => [d.childId, d.callId])).toEqual([['child-codex', ''], ['child-dsh', 'call-1']])
    const store = new InspectorStore()
    store.insertLogTurns('s', turns)
    const scopes = store.getTurn('s', 1)!.scopes
    const codex = scopes.find(s => s.scopeId === 'child-codex')!
    expect(codex).toMatchObject({ kind: 'subagent', label: 'Codex', status: 'ok' })
    expect(codex.error).toBeUndefined()
    expect(codex.delegatedBy).toBeUndefined()
  })

  it('links a delegated child to the main request whose tool call started it, both ways', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(log()))
    store.noteChildProvider('child-codex', 'codex-local')
    store.noteChildProvider('child-dsh', 'dsh-cli')
    const scopes = store.getTurn('s', 1)!.scopes
    const main = scopes.find(s => s.kind === 'main')!
    expect(scopes.find(s => s.scopeId === 'child-dsh')).toMatchObject({ provider: 'dsh-cli', delegatedBy: { turnSeq: 1, scopeId: 'main', requestNumber: 1 } })
    expect(scopes.find(s => s.scopeId === 'child-codex')?.provider).toBe('codex-local')
    expect(main.requests[0]?.delegates).toEqual([{ scopeId: 'child-dsh', external: false }])
  })

  it('attaches a compaction to the turn it happened in and readdresses every link to it', () => {
    const store = new InspectorStore()
    store.insertLogTurns('s', reconstructSession(log()))
    const list = store.listTurns('s').turns
    expect(list.map(t => t.hostTurn)).toEqual([1, 2])
    const turn2 = store.getTurn('s', 2)!
    const compaction = turn2.scopes.find(s => s.kind === 'compaction')!
    expect(compaction.scopeId).toMatch(/^compaction:-/)
    expect(compaction.compaction).toMatchObject({ replacedCount: 2 })
    expect(compaction.requests[0]?.scopeId).toBe(compaction.scopeId)
    const view = store.getRequest('s', compaction.requests[0]!.seq)
    if (view === undefined || 'refused' in view) throw new Error('missing')
    expect(view.scopeId).toBe(compaction.scopeId)
    // The request after the compaction links back to it at its new address.
    const after = turn2.scopes.find(s => s.kind === 'main')!.requests.at(-1)!
    const afterView = store.getRequest('s', after.seq)
    if (afterView === undefined || 'refused' in afterView) throw new Error('missing')
    const checkpoint = [...afterView.segments.history, ...afterView.segments.added].find(r => r.compactionId === 'c1')
    expect(checkpoint?.compactionRequest).toMatchObject({ turnSeq: 2, scopeId: compaction.scopeId })
    // The trend carries it under the host turn too.
    expect(store.getSessionTrend('s').requests.find(r => r.scopeId === compaction.scopeId)?.turnSeq).toBe(2)
  })

  it('reports the parent of a session opened on its own', () => {
    const store = new InspectorStore()
    store.noteParent('child', { sessionId: 'session-room', title: '邀请Claude、Kimi和Codex打招呼', hostTurn: 1, label: 'Codex' })
    expect(store.listTurns('child').parent).toEqual({ sessionId: 'session-room', title: '邀请Claude、Kimi和Codex打招呼', hostTurn: 1, label: 'Codex' })
  })

  it('lists only the agents that ran in a turn, and names what started a turn no human did', () => {
    const rows = log()
    // Turn 2 starts from a room delivery instead of a human message, and calls Codex again.
    rows.splice(12, 1, { type: 'user/message', seq: 12, time: 1200, surfaceOp: 'append', data: { id: 'room1', role: 'user', content: [{ type: 'text', text: '收到执行请求' }], source: { kind: 'room' } } })
    rows.splice(13, 0, { type: 'subagent/catalog', seq: 112, time: 1250, data: { childId: 'child-codex-2', mode: 'one-shot', label: 'Codex' } })
    const store = new InspectorStore()
    const turns = reconstructSession(rows)
    expect(turns.find(t => t.hostTurn === 2)).toMatchObject({ query: '', trigger: { source: 'room', text: '收到执行请求' } })
    store.insertLogTurns('s', turns)
    store.noteChildProvider('child-codex', 'codex-local')
    store.noteChildProvider('child-codex-2', 'codex-local')
    expect(store.listTurns('s').turns.find(t => t.hostTurn === 2)?.trigger).toEqual({ source: 'room', text: '收到执行请求' })
    // Each turn lists only the agents that ran in it.
    expect(store.getTurn('s', 2)!.scopes.filter(sc => sc.kind === 'subagent').map(sc => sc.scopeId)).toEqual(['child-codex-2'])
  })
})
