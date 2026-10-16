/**
 * The per-request 输出 contract (`CapturedRequest.response`): the live lane
 * assembles the request's own response from its stream — block-end content is
 * authoritative, deltas keep a cancelled block's partial text, and a failure
 * before any block leaves the field absent. The turn-final request is the
 * blind spot this field fixes: its response never appears in a next request.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { reconstructSession } from '../src/log-lane.ts'
import { InspectorStore, responseFromSpans, type RequestSnapshot } from '../src/store.ts'
import type { CapturedMessage } from '../src/messages.ts'

function clock(start = 1_000_000): { now: () => number; tick: (ms: number) => number } {
  let t = start
  return { now: () => t, tick: (ms: number) => (t += ms) }
}

function snap(messages: CapturedMessage[]): RequestSnapshot {
  return { sessionId: 's1', config: {}, messages }
}

/** Begin a request inside a turn and drive it with scripted chunks. */
function drive(
  store: InspectorStore,
  at: { tick: (ms: number) => number },
  chunks: Parameters<InspectorStore['observeChunk']>[1][],
  thrown?: Error,
) {
  const request = store.beginRequest(snap([{ role: 'user', sourceKind: 'user', content: [{ type: 'text', text: '问' }] }]), at.tick(10))
  if (request === undefined) throw new Error('request not captured')
  for (const chunk of chunks) store.observeChunk(request, chunk, at.tick(5))
  store.settleRequest(request, at.tick(5), thrown)
  return store.getRequest('s1', request.seq)
}

describe('responseFromSpans', () => {
  it('assembles reasoning + tool calls from a scripted block stream', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const detail = drive(store, at, [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: '先想' },
      { type: 'reasoning-delta', index: 0, text: '一下' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先想一下' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: 'c1', name: 'read', argumentsDelta: '{"path":' },
      { type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: '"a.ts"}' },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
    expect(detail?.response).toEqual({
      reasoning: '先想一下',
      toolCalls: [{ callId: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }],
    })
  })

  it('keeps a text-only response', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const detail = drive(store, at, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '直接' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '直接答复' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(detail?.response).toEqual({ text: '直接答复', toolCalls: [] })
  })

  it('keeps the partial text of a cancelled mid-block stream (deltas, no block-end)', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const detail = drive(store, at, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '半截' },
      { type: 'text-delta', index: 0, text: '答复' },
    ], new Error('aborted by user'))
    expect(detail?.status).toBe('failed')
    expect(detail?.response).toEqual({ text: '半截答复', toolCalls: [] })
  })

  it('leaves the response absent when the call failed before any block', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const detail = drive(store, at, [
      { type: 'finish', reason: { kind: 'error', failure: { message: 'provider down' } } },
    ])
    expect(detail?.status).toBe('failed')
    expect(detail?.response).toBeUndefined()
  })

  it('prefers the authoritative block-end content over accumulated deltas', () => {
    expect(responseFromSpans([
      { kind: 'text', index: 0, start: 1, end: 2, text: '权威全文' },
    ])).toEqual({ text: '权威全文', toolCalls: [] })
    expect(responseFromSpans([])).toBeUndefined()
  })
})


describe('tool execution results', () => {
  it('pairs reversed same-name results by ID, preserves input counts, and identifies later input provenance', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const chunks: Parameters<InspectorStore['observeChunk']>[1][] = ['a', 'b'].flatMap((id, index) => [
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: 'write', arguments: '{}' } },
    ])
    chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
    const first = drive(store, at, chunks)!
    const before = store.getTurn('s1', 1)!.scopes[0]!.requests[0]!.totalChars
    for (const id of ['a', 'b']) store.toolCall('s1', id, 'write', '{}', at.tick(1))
    expect(store.getRequest('s1', first.seq)?.response?.toolCalls[0]?.execution?.status).toBe('running')
    const error = '真实错误：缺少必填字段。'.repeat(30)
    store.toolResult('s1', 'b', true, error, at.tick(1))
    store.toolResult('s1', 'a', false, '{"ok":true}', at.tick(1))
    const captured = store.getRequest('s1', first.seq)!
    expect(captured.status).toBe('ok')
    expect(captured.response?.toolCalls.map(c => c.execution)).toEqual([
      { status: 'ok', result: '{"ok":true}' }, { status: 'failed', result: error },
    ])
    expect(store.getTurn('s1', 1)!.scopes[0]!.requests[0]).toMatchObject({ totalChars: before, toolErrors: 1 })
    const next = store.beginRequest(snap([{ role: 'tool', sourceKind: 'tool', toolCallId: 'b', isError: true, content: [{ type: 'text', text: error }] }]), at.tick(1))!
    expect(store.getRequest('s1', next.seq)?.segments.added[0]).toMatchObject({ sourceRequestNumber: 1, toolCallId: 'b', isError: true })
    // Similar tool names with no call ID must never acquire somebody else's result.
    expect(responseFromSpans([{ kind: 'tool-call', index: 0, start: 0, toolName: 'write' }])?.toolCalls[0]?.execution).toBeUndefined()
  })

  it('charges late results to the retention budget while keeping input totals separate', () => {
    const at = clock()
    const store = new InspectorStore({ maxStoredCharsTotal: 100000 }, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const first = drive(store, at, [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'late', name: 'write', arguments: '{}' } },
    ])!
    store.toolCall('s1', 'late', 'write', '{}', at.tick(1))
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(1))
    const history = reconstructSession(JSON.parse(readFileSync(new URL('./fixtures/main-session.json', import.meta.url), 'utf8')))
    store.insertLogTurns('history', history.slice(0, 1))
    expect(store.getTurn('history', 1)).toBeDefined()
    store.toolResult('s1', 'late', true, 'x'.repeat(100001), at.tick(1))
    // Live captures keep priority: late result storage displaces backfilled history.
    expect(store.getTurn('history', 1)).toBeUndefined()
    expect(store.getRequest('s1', first.seq)?.response?.toolCalls[0]?.execution?.result).toHaveLength(100001)
  })
})
