/**
 * Store coverage: turn/scope correlation, the purpose pseudo-bucket, the
 * six-bucket timing view, turn-granular eviction (per-session and global), and
 * the failed-delegation scope.
 */
import { describe, expect, it } from 'vitest'
import { InspectorStore, type RequestSnapshot } from '../src/store.ts'
import type { CapturedMessage } from '../src/messages.ts'
import type { LogTurn } from '../src/log-lane.ts'

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
}

/**
 * Drive one request through begin → chunks → settle against the fake clock.
 * Timeline: begin → wait 100 → reasoning 50 → gap 20 → text/tool-args 200
 * → usage/finish/settle tails 5×3 — total 385, with a 35ms `other` residual
 * (the 20ms inter-block gap plus the 15ms settle tail).
 */
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
  store.observeChunk(request, { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 500 } }, at.tick(5))
  store.observeChunk(request, { type: 'finish', reason: { kind: script.kind === 'tool' ? 'tool-calls' : 'stop' } }, at.tick(5))
  store.settleRequest(request, at.tick(5))
  return request
}

describe('turn correlation', () => {
  it('groups a turn’s requests and answers listTurns/getTurn/getRequest', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    store.noteUserMessage('s1', 'user', '把第一章 的对账跑完')
    const r1 = runRequest(store, snap('s1', [
      msg('sys', '提示词', 'system', 'system-prompt'),
      msg('u1', '把第一章的对账跑完'),
    ]), at, { kind: 'tool', args: '{"file_path":"/home/user/a.md"}' })
    store.toolCall('s1', 'call_1', 'read', '{"file_path":"/home/user/a.md"}', at.tick(10))
    store.toolResult('s1', 'call_1', false, '文件内容…', at.tick(46))
    store.noteAssistantMessage('s1', 'a1')
    const r2 = runRequest(store, snap('s1', [
      msg('sys', '提示词', 'system', 'system-prompt'),
      msg('u1', '把第一章的对账跑完'),
      { id: 'a1', role: 'assistant', sourceKind: 'model', content: [{ type: 'tool-call', id: 'call_1', name: 'read', arguments: '{}' }] },
      { id: 't1', role: 'tool', sourceKind: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: '文件内容' }] },
    ]), at)
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(10))

    const turns = store.listTurns('s1').turns
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      sessionId: 's1',
      turnSeq: 1,
      query: '把第一章 的对账跑完',
      requestCount: 2,
      scopeCount: 1,
      failedScopeCount: 0,
      totalInputTokens: 200,
      totalOutputTokens: 40,
      closingMessageId: 'a1',
    })

    const overview = store.getTurn('s1', 1)
    expect(overview?.scopes).toHaveLength(1)
    expect(overview?.scopes[0]?.requests.map(request => request.seq)).toEqual([r1.seq, r2.seq])
    expect(overview?.scopes[0]?.status).toBe('ok')

    // The six-bucket timing of the tool-call request.
    const full = store.getRequest('s1', r1.seq)
    expect(full?.timing).toEqual({
      waitMs: 100,
      reasoningMs: 50,
      toolArgsMs: 200,
      toolExecMs: 46,
      totalMs: 385,
    })
    expect(full?.responseSummary).toEqual({ kind: 'tool', name: 'read', hint: 'a.md' })
    expect(full?.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 500 })
    // The second request splits history (sys, u1) from added (a1, t1).
    const second = store.getRequest('s1', r2.seq)
    expect(second?.segments.history.map(item => item.index)).toEqual([1])
    expect(second?.segments.added.map(item => item.category)).toEqual(['assistant', 'tool-result'])
    expect(second?.segments.added[0]?.durationMs).toBe(385)
  })

  it('routes purpose requests into a per-session pseudo-bucket outside any turn', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    const aux = snap('s1', [msg('', '起标题')], { purpose: 'session-title', systemSlot: 'Create a concise title…' })
    runRequest(store, aux, at)
    runRequest(store, aux, at)

    const turns = store.listTurns('s1').turns
    expect(turns).toHaveLength(1)
    expect(turns[0]?.query).toBe('session-title')
    expect(turns[0]?.requestCount).toBe(2)
    // A purpose bucket has no host turn: negative address, no hostTurn marker.
    expect(turns[0]?.hostTurn).toBeUndefined()
    expect(turns[0]?.turnSeq).toBeLessThan(0)
    const overview = store.getTurn('s1', turns[0]?.turnSeq ?? 0)
    expect(overview?.scopes[0]?.scopeId).toBe('main')
    const detail = store.getRequest('s1', overview?.scopes[0]?.requests[0]?.seq ?? -1)
    expect(detail?.purpose).toBe('session-title')
    expect(detail?.segments.system[0]?.index).toBe(-1)

    // A purpose-less request with no open turn lands in the ad-hoc bucket.
    runRequest(store, snap('s1', [msg('', '散调用')]), at)
    const all = store.listTurns('s1').turns
    expect(all.map(item => item.query)).toEqual(['session-title', 'ad-hoc'])
  })

  it('marks a failed turn’s main scope', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    runRequest(store, snap('s1', [msg('u1', '跑')]), at)
    store.turnEnd('s1', 1, { kind: 'error', error: { message: 'provider down' } }, at.tick(5))
    const overview = store.getTurn('s1', 1)
    expect(overview?.scopes[0]?.status).toBe('failed')
    expect(overview?.scopes[0]?.error).toBe('provider down')
    expect(store.listTurns('s1').turns[0]?.failedScopeCount).toBe(1)
  })
})

describe('turn timing aggregation', () => {
  it('partitions each request into ordered lanes and aggregates per tool', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    runRequest(store, snap('s1', [msg('u1', '跑')]), at, { kind: 'tool' })
    store.toolCall('s1', 'call_1', 'read', '{}', at.tick(10))
    store.toolResult('s1', 'call_1', false, 'ok', at.tick(46))
    runRequest(store, snap('s1', [msg('u1', '跑')]), at)
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(10))

    const timing = store.getTurnTiming('s1', 1)
    expect(timing).toBeDefined()
    const { buckets, lanes } = timing ?? { buckets: undefined, lanes: [] }
    // Per request: wait 100 + reasoning 50 + (tool args | text) 200 + other 35.
    expect(buckets?.waitMs).toBe(200)
    expect(buckets?.reasoningMs).toBe(100)
    expect(buckets?.toolArgsMs).toBe(200)
    expect(buckets?.textMs).toBe(200)
    expect(buckets?.toolExecMs).toBe(46)
    expect(buckets?.otherMs).toBe(70)
    // Lanes strictly ordered by start time.
    for (let i = 1; i < lanes.length; i += 1) {
      expect(lanes[i]?.startedAt).toBeGreaterThanOrEqual(lanes[i - 1]?.startedAt ?? 0)
    }
    const execLane = lanes.find(lane => lane.kind === 'tool-exec')
    expect(execLane).toMatchObject({ tool: 'read', durationMs: 46 })
    expect(timing?.tools).toEqual([{ tool: 'read', calls: 1, totalMs: 46, argsMs: 200 }])
  })
})

describe('eviction', () => {
  it('evicts the oldest closed turn past maxTurnsPerSession', () => {
    const at = clock()
    const store = new InspectorStore({ maxTurnsPerSession: 2 }, { now: at.now })
    for (let turn = 1; turn <= 3; turn += 1) {
      store.turnStart('s1', turn, at.tick(1))
      runRequest(store, snap('s1', [msg(`u${turn}`, `问题${turn}`)]), at)
      store.turnEnd('s1', turn, { kind: 'completed' }, at.tick(1))
    }
    const turns = store.listTurns('s1').turns
    expect(turns.map(item => item.turnSeq)).toEqual([2, 3])
  })

  it('char pressure evicts the oldest backfilled turn across sessions; live turns never yield', () => {
    const at = clock()
    // Live requests here are ~230 chars; the backfilled turns are exactly 3000
    // each. Budget 6400: live(1) + T1 + T2 fits (≈6231); live(2) overruns.
    const store = new InspectorStore({ maxStoredCharsTotal: 6_400 }, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    runRequest(store, snap('s1', [msg('u1', '活'.repeat(200))]), at)
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(1))
    store.insertLogTurns('s2', [
      logTurnFixture(1, at.tick(1), 2, 1_500),
      logTurnFixture(2, at.tick(1), 2, 1_500),
    ])
    expect(store.listTurns('s2').turns.map(item => item.turnSeq)).toEqual([1, 2])
    // A second live turn on s1 pushes the store over the char budget: the
    // oldest backfilled turn (s2's T1) evicts; every live turn stays.
    store.turnStart('s1', 2, at.tick(1))
    runRequest(store, snap('s1', [msg('u2', '活'.repeat(200))]), at)
    store.turnEnd('s1', 2, { kind: 'completed' }, at.tick(1))
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([1, 2])
    expect(store.listTurns('s2').turns.map(item => item.turnSeq)).toEqual([2])
  })

  it('never evicts a turn whose stream is still open', () => {
    const at = clock()
    const store = new InspectorStore({ maxTurnsPerSession: 1 }, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const live = store.beginRequest(snap('s1', [msg('u1', 'a')]), at.tick(1))
    expect(live?.status).toBe('streaming')
    store.turnStart('s1', 2, at.tick(1)) // defensive: ignored while 1 is open
    // The cap is soft while a stream is open: turn 1 survives.
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([1])
    if (live !== undefined) store.settleRequest(live, at.tick(5))
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(1))
    store.turnStart('s1', 2, at.tick(1))
    runRequest(store, snap('s1', [msg('u2', 'b')]), at)
    store.turnEnd('s1', 2, { kind: 'completed' }, at.tick(1))
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([2])
  })
})

describe('subagent scopes', () => {
  it('fails a delegation scope whose result is an error, with zero requests', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    const request = runRequest(store, snap('s1', [msg('u1', '跑对账')]), at, {
      kind: 'tool',
      callId: 'call_sub',
      name: 'subagent_dsh',
      args: '{"description":"第一章对账 JSON 提取"}',
    })
    store.toolCall('s1', 'call_sub', 'subagent_dsh', '{"description":"第一章对账 JSON 提取"}', at.tick(10))
    store.subagentCatalog('s1', 'child-1', 'dsh: 第一章对账 JSON 提取', at.tick(50))
    store.toolResult('s1', 'call_sub', true, 'Error: subagent run failed', at.tick(1300))
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(10))

    const overview = store.getTurn('s1', 1)
    const child = overview?.scopes.find(scope => scope.kind === 'subagent')
    expect(child).toMatchObject({
      scopeId: 'child-1',
      scopeSeq: 2,
      status: 'failed',
      label: 'dsh: 第一章对账 JSON 提取',
      requests: [],
    })
    expect(overview?.scopes.find(scope => scope.kind === 'main')?.scopeSeq).toBe(1)
    expect(overview?.turn.failedScopeCount).toBe(1)
    // The delegation’s own exec time still attributes to the issuing request:
    // tool/call → tool/result spans the catalog write in between.
    expect(store.getRequest('s1', request.seq)?.timing.toolExecMs).toBe(1350)
  })

  it('opens a call-only scope for a delegation that never reached the catalog', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    runRequest(store, snap('s1', [msg('u1', '跑')]), at, {
      kind: 'tool',
      callId: 'call_sub',
      name: 'subagent_dsh',
      args: '{"description":"连通性测试"}',
    })
    store.toolCall('s1', 'call_sub', 'subagent_dsh', '{"description":"连通性测试"}', at.tick(10))
    store.toolResult('s1', 'call_sub', true, 'Error: spawn failed', at.tick(100))
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(10))

    const overview = store.getTurn('s1', 1)
    const child = overview?.scopes.find(scope => scope.kind === 'subagent')
    expect(child).toMatchObject({
      scopeId: 'call:call_sub',
      scopeSeq: 2,
      status: 'failed',
      label: '连通性测试',
      requests: [],
    })
  })

  it('numbers scopes per session in creation order, across turns and buckets', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.turnStart('s1', 1, at.tick(1))
    runRequest(store, snap('s1', [msg('u1', '一')]), at) // main scope → 1
    store.subagentCatalog('s1', 'child-1', '子任务', at.tick(1)) // → 2
    store.turnEnd('s1', 1, { kind: 'completed' }, at.tick(1))
    // An aux request outside any turn: the pseudo-bucket's main scope → 3.
    runRequest(store, snap('s1', [msg('', '起标题')], { purpose: 'session-title' }), at)
    store.turnStart('s1', 2, at.tick(1))
    runRequest(store, snap('s1', [msg('u2', '二')]), at) // turn 2 main scope → 4
    store.turnEnd('s1', 2, { kind: 'completed' }, at.tick(1))

    const turn1 = store.getTurn('s1', 1)
    expect(turn1?.scopes.map(scope => [scope.scopeId, scope.scopeSeq])).toEqual([['main', 1], ['child-1', 2]])
    const bucketItem = store.listTurns('s1').turns.find(item => item.hostTurn === undefined)
    const bucket = store.getTurn('s1', bucketItem?.turnSeq ?? 0)
    expect(bucket?.scopes[0]?.scopeSeq).toBe(3)
    const turn2 = store.getTurn('s1', 2)
    expect(turn2?.scopes[0]?.scopeSeq).toBe(4)
  })
})

/** One reconstructed turn fixture: `requests` rows of `chars` segment chars each. */
function logTurnFixture(hostTurn: number, startedAt: number, requests: number, chars: number): LogTurn {
  return {
    hostTurn,
    query: `重建 ${hostTurn}`,
    startedAt,
    endedAt: startedAt + 10,
    requests: Array.from({ length: requests }, (_, index) => ({
      startedAt,
      status: 'ok' as const,
      config: {},
      responseSummary: { kind: 'none' as const },
      segments: { system: [], tools: [], history: [], added: [] },
      totalChars: chars,
      blocks: [],
      execs: [],
      fingerprint: { messageKeys: [`h${hostTurn}:${index}`], toolNames: [] },
    })),
    delegations: [],
  }
}

describe('backfill budgets and the watermark', () => {
  it('keeps the loaded turns contiguous: the first turn that does not fit ends the fill', () => {
    const at = clock()
    const store = new InspectorStore({ maxBackfillRequestsPerSession: 3 }, { now: at.now })
    const inserted = store.insertLogTurns('s1', [
      logTurnFixture(1, at.tick(1), 1, 100),
      logTurnFixture(2, at.tick(1), 5, 100), // oversized: 5 > the cap
      logTurnFixture(3, at.tick(1), 2, 100),
    ])
    // T1 would fit, but loading it would leave a hole at T2 that paging could never fill.
    expect(inserted).toBe(1)
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([3])
    // The drop keeps the watermark retryable (not 'complete').
    expect(store.listTurns('s1').backfill.state).toBe('partial')
  })

  it('skips an oversized newest turn so the window cannot get stuck on it', () => {
    const at = clock()
    const store = new InspectorStore({ maxBackfillRequestsPerSession: 3 }, { now: at.now })
    store.insertLogTurns('s1', [logTurnFixture(1, at.tick(1), 1, 100), logTurnFixture(2, at.tick(1), 2, 100), logTurnFixture(3, at.tick(1), 5, 100)])
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([1, 2])
  })

  it('marks complete only when every candidate fit', () => {
    const at = clock()
    const store = new InspectorStore({}, { now: at.now })
    store.insertLogTurns('s1', [logTurnFixture(1, at.tick(1), 1, 100), logTurnFixture(2, at.tick(1), 1, 100)])
    expect(store.listTurns('s1').backfill.state).toBe('complete')
    // A fresh live-only session never read a log: state stays 'none'.
    store.turnStart('s2', 1, at.tick(1))
    expect(store.listTurns('s2').backfill.state).toBe('none')
  })

  it('refills after eviction freed room (retry while partial)', () => {
    const at = clock()
    // Per-session request cap 2: attempt 1 keeps T4+T3, drops T2+T1.
    const store = new InspectorStore(
      { maxBackfillRequestsPerSession: 2, maxStoredCharsTotal: 250 },
      { now: at.now },
    )
    const logTurns = [
      logTurnFixture(1, at.tick(1), 1, 100),
      logTurnFixture(2, at.tick(1), 1, 50),
      logTurnFixture(3, at.tick(1), 1, 100),
      logTurnFixture(4, at.tick(1), 1, 100),
    ]
    expect(store.insertLogTurns('s1', logTurns)).toBe(2)
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([3, 4])
    expect(store.listTurns('s1').backfill.state).toBe('partial')
    // A live insert elsewhere drives the store over the char budget: the
    // oldest backfilled turn (T3) evicts, freeing s1's request room.
    store.turnStart('s2', 1, at.tick(1))
    runRequest(store, snap('s2', [msg('u1', '压'.repeat(60))]), at)
    store.turnEnd('s2', 1, { kind: 'completed' }, at.tick(1))
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([4])
    expect(store.listTurns('s2').turns.map(item => item.turnSeq)).toEqual([1])
    // The next attempt (the service re-reads while partial) fills the smaller
    // dropped turn T2 into the freed room; T3/T1 stay dropped on chars.
    expect(store.insertLogTurns('s1', logTurns)).toBe(1)
    expect(store.listTurns('s1').turns.map(item => item.turnSeq)).toEqual([2, 4])
    expect(store.listTurns('s1').backfill.state).toBe('partial')
  })

  it('loads a window of turns ending where asked, and back to the latest', () => {
    const at = clock()
    const store = new InspectorStore({ maxTurnsPerSession: 3 }, { now: at.now })
    const logTurns = Array.from({ length: 8 }, (_, i) => logTurnFixture(i + 1, at.tick(1), 1, 10))
    store.insertLogTurns('s1', logTurns)
    expect(store.listTurns('s1').turns.map(item => item.hostTurn)).toEqual([6, 7, 8])
    expect(store.listTurns('s1').range).toEqual({ first: 1, last: 8 })
    store.setWindow('s1', 4)
    expect(store.listTurns('s1').turns).toEqual([])
    store.insertLogTurns('s1', logTurns)
    expect(store.listTurns('s1').turns.map(item => item.hostTurn)).toEqual([2, 3, 4])
    expect(store.listTurns('s1').backfill.state).toBe('complete')
    expect(store.listTurns('s1').evictedTurnCount).toBeUndefined()
    store.setWindow('s1', undefined)
    store.insertLogTurns('s1', logTurns)
    expect(store.listTurns('s1').turns.map(item => item.hostTurn)).toEqual([6, 7, 8])
  })

  it('takes room from the least recently read session instead of loading nothing', () => {
    const at = clock()
    const store = new InspectorStore({ maxStoredCharsTotal: 250 }, { now: at.now })
    store.insertLogTurns('old', [logTurnFixture(1, at.tick(1), 1, 100), logTurnFixture(2, at.tick(1), 1, 100)])
    at.tick(10)
    store.insertLogTurns('read', [logTurnFixture(1, at.tick(1), 1, 20)])
    at.tick(10)
    // A third session's turns do not fit in the free room; the least recently
    // read session ('old') yields its oldest backfilled turn, not 'read'.
    expect(store.insertLogTurns('new', [logTurnFixture(1, at.tick(1), 1, 100)])).toBe(1)
    expect(store.listTurns('new').turns.map(item => item.hostTurn)).toEqual([1])
    expect(store.listTurns('read').turns.map(item => item.hostTurn)).toEqual([1])
    expect(store.listTurns('old').turns.map(item => item.hostTurn)).toEqual([2])
    // 'old' lost backfill, so it refills when read again.
    expect(store.listTurns('old').backfill.state).toBe('partial')
  })
})
