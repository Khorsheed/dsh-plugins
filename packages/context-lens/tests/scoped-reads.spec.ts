/**
 * Scoped-read coverage: the caller-supplied scope allow-list filters all four
 * verbs (rows, aggregates, lanes, tools — a filtered-out scope contributes
 * nothing, and its child log is never opened on the query's behalf), the
 * zero-authorized result stays distinguishable from unknown addresses, the
 * fidelity markers expose live vs log-reconstructed, the eviction counter
 * separates collected-then-dropped from never-seen where the store can know
 * it, and every seq-bearing payload carries the instance generation.
 * Response-content pins: a request's own response rides getRequest only, and
 * a filtered-out scope's response (live or log-reconstructed) appears in no
 * verb's output — its log response records are never even read.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { InspectorService } from '../src/service.ts'
import { InspectorStore, type RequestSnapshot } from '../src/store.ts'
import type { ScopedRefusal } from '../src/types.ts'
import type { CapturedMessage } from '../src/messages.ts'
import type { LogTurn, SessionLogHandle, SessionLogReader, SessionLogRow } from '../src/log-lane.ts'

// The subagent package owns this event; the test declares the merge so
// Session.append accepts it (the production code reads it structurally).
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'subagent/catalog': {
      version: number
      childId: SessionId
      childCreatedAt: number
      mode: string
      label?: string
    }
  }
}

/** A mutable fake clock. */
function clock(start = 1_000_000): { now: () => number; tick: (ms: number) => number } {
  let t = start
  return { now: () => t, tick: (ms: number) => (t += ms) }
}

function msg(id: string, text: string, role: CapturedMessage['role'] = 'user', sourceKind = 'user'): CapturedMessage {
  const base: CapturedMessage = { role, sourceKind, content: [{ type: 'text', text }] }
  return id === '' ? base : { ...base, id }
}

function snap(sessionId: string, messages: CapturedMessage[], over: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return {
    sessionId,
    config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 },
    messages,
    tools: [{ name: 'read', description: '读文件', parameters: { type: 'object' } }],
    ...over,
  }
}

interface Script {
  kind: 'text' | 'tool'
  callId?: string
  name?: string
  args?: string
  /** When set, a trailing text block (index 2) carries this marker, delta-accumulated. */
  responseText?: string
}

/** One request through begin → chunks → settle against the fake clock (same timeline as store.spec). */
function runRequest(
  store: InspectorStore,
  snapshot: RequestSnapshot,
  at: { tick: (ms: number) => number },
  script: Script = { kind: 'text' },
) {
  const request = store.beginRequest(snapshot, at.tick(10))
  if (request === undefined) throw new Error('request not captured')
  store.observeChunk(request, { type: 'block-start', index: 0, blockType: 'reasoning' }, at.tick(100))
  store.observeChunk(request, { type: 'block-end', index: 0, block: { type: 'reasoning' } }, at.tick(50))
  if (script.kind === 'tool') {
    store.observeChunk(request, { type: 'block-start', index: 1, blockType: 'tool-call' }, at.tick(20))
    store.observeChunk(request, {
      type: 'block-end',
      index: 1,
      block: { type: 'tool-call', id: script.callId ?? 'call_1', name: script.name ?? 'read', arguments: script.args ?? '{}' },
    }, at.tick(200))
  } else {
    store.observeChunk(request, { type: 'block-start', index: 1, blockType: 'text' }, at.tick(20))
    store.observeChunk(request, { type: 'block-end', index: 1, block: { type: 'text' } }, at.tick(200))
  }
  if (script.responseText !== undefined) {
    store.observeChunk(request, { type: 'block-start', index: 2, blockType: 'text' }, at.tick(2))
    store.observeChunk(request, { type: 'text-delta', index: 2, text: script.responseText }, at.tick(2))
    store.observeChunk(request, { type: 'block-end', index: 2, block: { type: 'text' } }, at.tick(2))
  }
  store.observeChunk(request, { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }, at.tick(5))
  store.observeChunk(request, { type: 'finish', reason: { kind: script.kind === 'tool' ? 'tool-calls' : 'stop' } }, at.tick(5))
  store.settleRequest(request, at.tick(5))
  return request
}

/** One reconstructed turn fixture (log lane fidelity: logFilled scope, no live content). */
function logTurnFixture(hostTurn: number, startedAt: number): LogTurn {
  return {
    hostTurn,
    query: `重建 ${hostTurn}`,
    startedAt,
    endedAt: startedAt + 10,
    requests: [{
      startedAt,
      status: 'ok',
      config: {},
      responseSummary: { kind: 'none' },
      segments: { system: [], tools: [], history: [], added: [] },
      totalChars: 100,
      blocks: [],
      execs: [],
      fingerprint: { messageKeys: [`h${hostTurn}:0`], toolNames: [] },
    }],
    delegations: [],
  }
}

/**
 * The two-scope fixture: turn 1 with a live main scope (one request, one
 * `subagent_dsh` exec span) and a live in-process child scope `child-1`
 * (one request, one `write` exec span). Both requests carry 100/20 usage.
 * `childResponseText` gives the child's request a marked text response
 * (delta-accumulated, the live lane's partial-visibility path).
 */
function twoScopeStore(childResponseText?: string): { store: InspectorStore; mainSeq: number; childSeq: number } {
  const at = clock()
  const store = new InspectorStore({}, { now: at.now, generation: 'gen-fixture' })
  store.turnStart('s1', 1, at.tick(1))
  store.noteUserMessage('s1', 'user', '跑对账')
  const main = runRequest(store, snap('s1', [msg('u1', '跑对账')]), at, {
    kind: 'tool',
    callId: 'call_sub',
    name: 'subagent_dsh',
    args: '{"description":"对账"}',
  })
  store.toolCall('s1', 'call_sub', 'subagent_dsh', '{"description":"对账"}', at.tick(10))
  store.subagentCatalog('s1', 'child-1', 'dsh: 对账', at.tick(5))
  const child = runRequest(store, snap('child-1', [msg('cu1', '子任务')]), at, {
    kind: 'tool',
    callId: 'call_c1',
    name: 'write',
    args: '{}',
    ...childResponseText === undefined ? {} : { responseText: childResponseText },
  })
  store.toolCall('child-1', 'call_c1', 'write', '{}', at.tick(10))
  store.toolResult('child-1', 'call_c1', false, 'ok', at.tick(30))
  store.toolResult('s1', 'call_sub', false, '{"chapters":[]}', at.tick(20))
  store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(10))
  return { store, mainSeq: main.seq, childSeq: child.seq }
}

const MAIN_ONLY = { scopes: ['main'] } as const

describe('scoped reads (the caller-supplied allow-list)', () => {
  it('listTurns aggregates only the authorized scopes; turn rows stay listed', () => {
    const { store } = twoScopeStore()
    const unfiltered = store.listTurns('s1')
    expect(unfiltered.turns[0]).toMatchObject({ requestCount: 2, scopeCount: 2, totalInputTokens: 200, totalOutputTokens: 40 })
    expect(unfiltered.authorizedScopes).toBeUndefined()

    const result = store.listTurns('s1', MAIN_ONLY)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]).toMatchObject({
      turnSeq: 1,
      query: '跑对账',
      requestCount: 1,
      scopeCount: 1,
      failedScopeCount: 0,
      totalInputTokens: 100,
      totalOutputTokens: 20,
    })
    expect(result.authorizedScopes).toEqual(['main'])
  })

  it('getTurn drops the filtered scope from rows and aggregates', () => {
    const { store, mainSeq } = twoScopeStore()
    const overview = store.getTurn('s1', 1, MAIN_ONLY)
    expect(overview?.scopes.map(scope => scope.scopeId)).toEqual(['main'])
    expect(overview?.scopes[0]?.requests.map(request => request.seq)).toEqual([mainSeq])
    expect(overview?.turn).toMatchObject({ requestCount: 1, scopeCount: 1, totalInputTokens: 100 })
    expect(overview?.authorizedScopes).toEqual(['main'])
    // Unfiltered: both scopes, no marker.
    const full = store.getTurn('s1', 1)
    expect(full?.scopes.map(scope => scope.scopeId)).toEqual(['main', 'child-1'])
    expect(full?.authorizedScopes).toBeUndefined()
  })

  it('getTurnTiming drops the filtered scope from lanes, buckets, and tools', () => {
    const { store } = twoScopeStore()
    // The main request's subagent_dsh exec spans the child work (460ms); the
    // child's write exec is 30ms. Sorted by totalMs descending.
    const full = store.getTurnTiming('s1', 1)
    expect(full?.tools.map(tool => tool.tool)).toEqual(['subagent_dsh', 'write'])
    const timing = store.getTurnTiming('s1', 1, MAIN_ONLY)
    expect(timing?.lanes.every(lane => lane.scopeId === 'main')).toBe(true)
    expect(timing?.tools).toEqual([{ tool: 'subagent_dsh', calls: 1, totalMs: 460, argsMs: 200 }])
    expect(timing?.authorizedScopes).toEqual(['main'])
    // Unfiltered totals: both requests' lanes aggregate (tool args 200ms each).
    expect(full?.buckets.toolArgsMs).toBe(400)
    expect(timing?.buckets.toolArgsMs).toBe(200)
    // The child's write exec (30ms) is gone from the filtered buckets; the main delegation exec stays.
    expect(full?.buckets.toolExecMs).toBe(490)
    expect(timing?.buckets.toolExecMs).toBe(460)
  })

  it('getRequest answers a ScopedRefusal for the filtered scope, a payload for the authorized one', () => {
    const { store, mainSeq, childSeq } = twoScopeStore()
    const refused = store.getRequest('s1', childSeq, MAIN_ONLY)
    expect(refused).toEqual({ refused: 'no-authorized-content', generation: 'gen-fixture' })
    const allowed = store.getRequest('s1', mainSeq, MAIN_ONLY)
    expect(allowed === undefined || 'refused' in allowed).toBe(false)
    // Unknown seq stays undefined — distinguishable from the refusal.
    expect(store.getRequest('s1', 999, MAIN_ONLY)).toBeUndefined()
    // Unfiltered: the same child seq serves its payload.
    const unfiltered = store.getRequest('s1', childSeq)
    expect(unfiltered !== undefined && !('refused' in unfiltered) && unfiltered.scopeId).toBe('child-1')
  })

  it('zero authorized content is explicit and distinct from unknown addresses', () => {
    const { store, mainSeq } = twoScopeStore()
    const nobody = { scopes: ['nobody'] } as const
    const list = store.listTurns('s1', nobody)
    expect(list.turns[0]).toMatchObject({ requestCount: 0, scopeCount: 0, totalInputTokens: 0, totalOutputTokens: 0 })
    expect(list.authorizedScopes).toEqual([])

    const overview = store.getTurn('s1', 1, nobody)
    expect(overview?.scopes).toEqual([])
    expect(overview?.turn.query).toBe('跑对账')
    expect(overview?.authorizedScopes).toEqual([])

    const timing = store.getTurnTiming('s1', 1, nobody)
    expect(timing?.lanes).toEqual([])
    expect(timing?.tools).toEqual([])
    expect(timing?.buckets).toEqual({ waitMs: 0, reasoningMs: 0, toolArgsMs: 0, textMs: 0, toolExecMs: 0, otherMs: 0 })
    expect(timing?.authorizedScopes).toEqual([])

    const refused = store.getRequest('s1', mainSeq, nobody)
    expect(refused !== undefined && 'refused' in refused && refused.refused).toBe('no-authorized-content')

    // An empty allow-list authorizes nothing (vs an absent filter, which filters nothing).
    expect(store.getTurn('s1', 1, { scopes: [] })?.authorizedScopes).toEqual([])

    // Unknown session / turn: no marker at all — never confused with zero-authorized.
    expect(store.listTurns('unknown-session', nobody).authorizedScopes).toBeUndefined()
    expect(store.getTurn('s1', 99, nobody)).toBeUndefined()
    expect(store.getTurnTiming('s1', 99, nobody)).toBeUndefined()
  })
})

describe('response content under the filter', () => {
  const MARKER = 'child-secret-response-63a1'

  it('a filtered-out scope’s response content appears in none of the four verbs', () => {
    const { store, mainSeq, childSeq } = twoScopeStore(MARKER)

    // Capture works: unfiltered, the child's own response rides getRequest.
    const captured = store.getRequest('s1', childSeq)
    expect(captured !== undefined && !('refused' in captured) && captured.response?.text).toBe(MARKER)

    // Surface inventory: response content lives ONLY on CapturedRequest —
    // even unfiltered, the list/overview/timing envelopes never carry it.
    expect(JSON.stringify(store.listTurns('s1'))).not.toContain(MARKER)
    expect(JSON.stringify(store.getTurn('s1', 1))).not.toContain(MARKER)
    expect(JSON.stringify(store.getTurnTiming('s1', 1))).not.toContain(MARKER)

    // Filtered: no verb's output carries the marker anywhere.
    const refused = store.getRequest('s1', childSeq, MAIN_ONLY)
    expect(refused).toEqual({ refused: 'no-authorized-content', generation: 'gen-fixture' })
    expect(JSON.stringify(refused)).not.toContain(MARKER)
    expect(JSON.stringify(store.listTurns('s1', MAIN_ONLY))).not.toContain(MARKER)
    expect(JSON.stringify(store.getTurn('s1', 1, MAIN_ONLY))).not.toContain(MARKER)
    expect(JSON.stringify(store.getTurnTiming('s1', 1, MAIN_ONLY))).not.toContain(MARKER)
    // The authorized scope's own response still flows (and carries no marker).
    const mainPayload = store.getRequest('s1', mainSeq, MAIN_ONLY)
    expect(JSON.stringify(mainPayload)).toContain('subagent_dsh')
    expect(JSON.stringify(mainPayload)).not.toContain(MARKER)
  })
})

describe('fidelity markers', () => {
  it('exposes live vs log-reconstructed per turn and per scope', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now, generation: 'gen-fixture' })
    store.insertLogTurns('s1', [logTurnFixture(1, at.tick(1))])
    store.turnStart('s1', 2, at.tick(1))
    runRequest(store, snap('s1', [msg('u2', '活')]), at)
    store.subagentCatalog('s1', 'child-empty', '空跑', at.tick(1))
    store.turnEnd('s1', 2, { kind: 'completed' }, at.tick(1))

    const items = store.listTurns('s1').turns
    expect(items.find(item => item.turnSeq === 1)?.origin).toBe('log-reconstructed')
    expect(items.find(item => item.turnSeq === 2)?.origin).toBe('live')

    const backfilled = store.getTurn('s1', 1)
    expect(backfilled?.scopes[0]?.origin).toBe('log-reconstructed')
    const live = store.getTurn('s1', 2)
    expect(live?.scopes.find(scope => scope.scopeId === 'main')?.origin).toBe('live')
    // A scope with no captured content yet carries no fidelity marker.
    expect(live?.scopes.find(scope => scope.scopeId === 'child-empty')?.origin).toBeUndefined()
  })
})

describe('eviction distinguishability', () => {
  it('counts evicted turns; unknown sessions carry no signal', () => {
    const at = clock()
    const store = new InspectorStore({ maxTurnsPerSession: 2 }, { now: at.now, generation: 'gen-fixture' })
    expect(store.listTurns('s1').evictedTurnCount).toBeUndefined()
    for (let turn = 1; turn <= 3; turn += 1) {
      store.turnStart('s1', turn, at.tick(1))
      runRequest(store, snap('s1', [msg(`u${turn}`, `问题${turn}`)]), at)
      store.turnEnd('s1', turn, { kind: 'completed' }, at.tick(1))
    }
    const result = store.listTurns('s1')
    expect(result.turns.map(item => item.turnSeq)).toEqual([2, 3])
    expect(result.evictedTurnCount).toBe(1)
    // Never-seen session: no turns, no eviction signal, watermark 'none'.
    const unknown = store.listTurns('nope')
    expect(unknown.turns).toEqual([])
    expect(unknown.evictedTurnCount).toBeUndefined()
    expect(unknown.backfill.state).toBe('none')
  })
})

describe('generation (restart invalidation)', () => {
  it('stamps the injected epoch on every seq-bearing result', () => {
    const { store, mainSeq, childSeq } = twoScopeStore()
    expect(store.listTurns('s1').generation).toBe('gen-fixture')
    expect(store.getTurn('s1', 1)?.generation).toBe('gen-fixture')
    expect(store.getTurnTiming('s1', 1)?.generation).toBe('gen-fixture')
    const request = store.getRequest('s1', mainSeq)
    expect(request !== undefined && !('refused' in request) && request.generation).toBe('gen-fixture')
    const refused = store.getRequest('s1', childSeq, MAIN_ONLY) as ScopedRefusal
    expect(refused.generation).toBe('gen-fixture')
  })

  it('mints a unique epoch per instance by default', () => {
    const a = new InspectorStore().listTurns('x').generation
    const b = new InspectorStore().listTurns('x').generation
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)
  })
})

// ---------- service-level: the child-log gate ----------

const childFixtureRows = JSON.parse(
  readFileSync(new URL('./fixtures/child-session.json', import.meta.url), 'utf8'),
) as SessionLogRow[]

/** A `sessionPersistence`-shaped reader serving per-id row lists and recording every open. */
class GateReader implements SessionLogReader {
  readonly opens: string[] = []
  constructor(private readonly logs: Record<string, SessionLogRow[]>) {}

  async open(id: string, _access: 'read'): Promise<SessionLogHandle> {
    this.opens.push(id)
    const rows = this.logs[id]
    if (rows === undefined) {
      const notFound = new Error(`session "${id}" not found`)
      notFound.name = 'SessionPersistenceNotFoundError'
      throw notFound
    }
    return {
      read: (offset = 0) => Promise.resolve({ events: rows.slice(offset) }),
      close: () => Promise.resolve(),
    }
  }
}

/** One turn with two catalog'd one-shot delegations (child-a bound first, then child-b). */
function delegateTwo(service: InspectorService): string {
  const session = service.ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_a' as ToolCallId,
    name: 'subagent_dsh',
    arguments: '{"description":"任务甲"}',
  })
  session.append('subagent/catalog', {
    version: 0,
    childId: 'child-a' as SessionId,
    childCreatedAt: 1,
    mode: 'one-shot',
    label: 'dsh: 任务甲',
  })
  session.append('tool/call', {
    turn: 1,
    step: 2,
    callId: 'call_b' as ToolCallId,
    name: 'subagent_dsh',
    arguments: '{"description":"任务乙"}',
  })
  session.append('subagent/catalog', {
    version: 0,
    childId: 'child-b' as SessionId,
    childCreatedAt: 2,
    mode: 'one-shot',
    label: 'dsh: 任务乙',
  })
  for (const callId of ['call_a', 'call_b'] as const) {
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: callId as ToolCallId,
        content: [{ type: 'text', text: '{}' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return String(session.id)
}

describe('the child-log gate', () => {
  it('never opens a filtered-out child scope’s log on the query’s behalf', async () => {
    const reader = new GateReader({
      'child-a': structuredClone(childFixtureRows),
      'child-b': structuredClone(childFixtureRows),
    })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const service = new InspectorService(ctx, {}, { persistence: reader, generation: 'gen-fixture' })
    const rootId = delegateTwo(service)

    const overview = await service.getTurn(rootId, 1, { scopes: ['main', 'child-a'] })
    expect(reader.opens.filter(id => id === 'child-a')).toEqual(['child-a'])
    expect(reader.opens.filter(id => id === 'child-b')).toEqual([])
    // The turn minted no main scope (no main-conversation request ran), so the
    // existing-and-authorized set is just child-a.
    expect(overview?.authorizedScopes).toEqual(['child-a'])
    const childA = overview?.scopes.find(scope => scope.scopeId === 'child-a')
    expect(childA?.requests).toHaveLength(3)
    expect(overview?.scopes.find(scope => scope.scopeId === 'child-b')).toBeUndefined()
    // The turn row aggregates only the authorized subset.
    expect(overview?.turn).toMatchObject({ scopeCount: 1, requestCount: 3 })

    // Unfiltered: both child logs read.
    await service.getTurn(rootId, 1)
    expect(reader.opens.filter(id => id === 'child-b')).toEqual(['child-b'])
    service.dispose()
  })

  it('an excluded child scope’s log response records are never read', async () => {
    const LOG_MARKER = 'child-b-log-response-92f7'
    // Child-b's log carries a response the parent never saw live; child-a's
    // does not — the marker can only arrive by opening child-b's log.
    const childBRows = structuredClone(childFixtureRows)
    const tail = childBRows[childBRows.length - 1]?.time ?? 0
    childBRows.push({
      type: 'assistant/message',
      seq: 31,
      time: tail + 300,
      data: {
        turn: 2,
        step: 1,
        message: {
          id: 'am-marker',
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [{ type: 'text', text: LOG_MARKER }],
        },
        usage: { inputTokens: 5, outputTokens: 2 },
        stream: [],
      },
    })
    const reader = new GateReader({
      'child-a': structuredClone(childFixtureRows),
      'child-b': childBRows,
    })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const service = new InspectorService(ctx, {}, { persistence: reader, generation: 'gen-fixture' })
    const rootId = delegateTwo(service)

    const filtered = await service.getTurn(rootId, 1, { scopes: ['main', 'child-a'] })
    expect(reader.opens.filter(id => id === 'child-b')).toEqual([])
    expect(JSON.stringify(filtered)).not.toContain(LOG_MARKER)
    expect(JSON.stringify(await service.listTurns(rootId, { scopes: ['main', 'child-a'] }))).not.toContain(LOG_MARKER)
    expect(JSON.stringify(await service.getTurnTiming(rootId, 1, { scopes: ['main', 'child-a'] }))).not.toContain(LOG_MARKER)

    // Non-vacuous: unfiltered, the same marker is reachable — via getRequest only.
    const full = await service.getTurn(rootId, 1)
    expect(reader.opens.filter(id => id === 'child-b')).toEqual(['child-b'])
    const childB = full?.scopes.find(scope => scope.scopeId === 'child-b')
    expect(JSON.stringify(full)).not.toContain(LOG_MARKER)
    const marked = await service.getRequest(rootId, childB?.requests[3]?.seq ?? -1)
    expect(marked !== undefined && !('refused' in marked) && marked.response?.text).toBe(LOG_MARKER)
    // And the filter still holds after the content is in memory.
    const refused = await service.getRequest(rootId, childB?.requests[3]?.seq ?? -1, { scopes: ['main', 'child-a'] })
    expect(refused).toEqual({ refused: 'no-authorized-content', generation: 'gen-fixture' })
    service.dispose()
  })
})
