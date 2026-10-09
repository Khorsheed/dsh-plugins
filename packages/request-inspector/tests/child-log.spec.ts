/**
 * Child-log lane coverage: a fresh-process subagent child's requests are
 * reconstructed from its on-disk session log (fixture: a compact, sanitized
 * slice of a real one-shot child), incrementally across refreshes, with the
 * honest empty states (no system prompt, no tools, no header config) intact.
 * The failed-delegation scope keeps zero requests when the log never existed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { InspectorService } from '../src/service.ts'
import type { SessionLogHandle, SessionLogReader, SessionLogRow } from '../src/log-lane.ts'

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

const fixtureRows = JSON.parse(
  readFileSync(new URL('./fixtures/child-session.json', import.meta.url), 'utf8'),
) as SessionLogRow[]

/** A `sessionPersistence`-shaped reader over an in-memory row list. */
class FixtureReader implements SessionLogReader {
  readonly opens: string[] = []
  constructor(
    readonly rows: SessionLogRow[],
    private readonly failure?: Error,
    /** When set, only this id has a log; anything else reads as not-yet-materialized. */
    private readonly serveId?: string,
  ) {}

  async open(id: string, _access: 'read'): Promise<SessionLogHandle> {
    this.opens.push(id)
    if (this.failure !== undefined) throw this.failure
    if (this.serveId !== undefined && id !== this.serveId) {
      const notFound = new Error(`session "${id}" not found`)
      notFound.name = 'SessionPersistenceNotFoundError'
      throw notFound
    }
    return {
      read: (offset = 0) => Promise.resolve({ events: this.rows.slice(offset) }),
      close: () => Promise.resolve(),
    }
  }
}

async function mount(persistence: SessionLogReader, warnings?: string[]): Promise<{
  ctx: Context
  service: InspectorService
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const service = new InspectorService(ctx, {}, {
    persistence,
    ...warnings === undefined ? {} : { logger: { warn: message => warnings.push(message) } },
  })
  return { ctx, service }
}

/** The parent-side delegation trace: call → catalog → ok result → turn end. */
function delegate(service: InspectorService, childId: string, failed: boolean): string {
  const session = service.ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_9' as ToolCallId,
    name: 'subagent_dsh',
    arguments: '{"description":"第一章对账 JSON 提取"}',
  })
  session.append('subagent/catalog', {
    version: 0,
    childId: childId as SessionId,
    childCreatedAt: 1,
    mode: 'one-shot',
    label: 'dsh: 第一章对账 JSON 提取',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: 'call_9' as ToolCallId,
      content: [{ type: 'text', text: failed ? 'Error: subagent run failed' : '{"chapters":[]}' }],
      isError: failed,
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return String(session.id)
}

describe('child-log lane', () => {
  it('reconstructs the child’s requests from the fixture log', async () => {
    const reader = new FixtureReader(structuredClone(fixtureRows), undefined, 'child-fixture')
    const { service } = await mount(reader)
    const rootId = delegate(service, 'child-fixture', false)

    const overview = await service.getTurn(rootId, 1)
    const child = overview?.scopes.find(scope => scope.kind === 'subagent')
    expect(child).toMatchObject({ scopeId: 'child-fixture', status: 'ok', label: 'dsh: 第一章对账 JSON 提取' })
    expect(child?.requests).toHaveLength(3)
    expect(reader.opens.filter(id => id === 'child-fixture')).toEqual(['child-fixture'])

    const [r1, r2, r3] = child?.requests ?? []
    // Request 1: step/start → first chunk → reasoning → tool args → exec.
    const first = await service.getRequest(rootId, r1?.seq ?? -1)
    expect(first?.status).toBe('ok')
    expect(first?.usage).toEqual({ inputTokens: 1488, outputTokens: 86, totalTokens: 6694, cacheReadTokens: 5120 })
    expect(first?.timing).toEqual({
      waitMs: 1791483625066 - 1791483620262,
      reasoningMs: 10,
      toolArgsMs: 107,
      toolExecMs: 18,
      totalMs: 1791483625202 - 1791483620262,
    })
    expect(first?.responseSummary).toEqual({ kind: 'tool', name: 'read', hint: '第1章.md' })
    // One-shot honesty: no system prompt, no tools, no header config in the log.
    expect(first?.segments.system).toEqual([])
    expect(first?.segments.tools).toEqual([])
    expect(first?.config).toEqual({})
    expect(first?.segments.history).toEqual([])
    expect(first?.segments.added.map(item => item.category)).toEqual(['user'])

    // Request 2: history = the user message; added = the response + its result.
    const second = await service.getRequest(rootId, r2?.seq ?? -1)
    expect(second?.usage).toMatchObject({ inputTokens: 2619, outputTokens: 2774 })
    expect(second?.timing.reasoningMs).toBe(1791483662411 - 1791483640307)
    expect(second?.timing.textMs).toBe(1791483688619 - 1791483662411)
    expect(second?.timing.toolExecMs).toBeUndefined()
    expect(second?.segments.history.map(item => item.category)).toEqual(['user'])
    expect(second?.segments.added.map(item => item.category)).toEqual(['assistant', 'tool-result'])
    expect(second?.segments.added[0]?.durationMs).toBe(1791483625202 - 1791483620262)
    expect(second?.responseSummary).toEqual({ kind: 'text' })

    // Request 3: the synthetic failed attempt.
    const third = await service.getRequest(rootId, r3?.seq ?? -1)
    expect(third?.status).toBe('failed')
    expect(third?.error).toBe('provider rate limit')
    expect(third?.usage).toBeUndefined()
    service.dispose()
  })

  it('is incremental across refreshes (no duplicate requests)', async () => {
    const rows = structuredClone(fixtureRows)
    const reader = new FixtureReader(rows, undefined, 'child-inc')
    const { service } = await mount(reader)
    const rootId = delegate(service, 'child-inc', false)

    const first = await service.getTurn(rootId, 1)
    expect(first?.scopes.find(scope => scope.kind === 'subagent')?.requests).toHaveLength(3)

    // The child finishes turn 2 with a retried success after the first read.
    const tail = rows[rows.length - 1]?.time ?? 0
    rows.push({
      type: 'assistant/message',
      seq: 31,
      time: tail + 300,
      data: {
        turn: 2,
        step: 1,
        message: {
          id: 'am3',
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [{ type: 'text', text: '重试成功' }],
        },
        usage: { inputTokens: 5, outputTokens: 2 },
        stream: [],
      },
    })
    const second = await service.getTurn(rootId, 1)
    const requests = second?.scopes.find(scope => scope.kind === 'subagent')?.requests ?? []
    expect(requests).toHaveLength(4)
    expect(requests.map(request => request.seq)).toEqual([...new Set(requests.map(request => request.seq))])
    const retried = await service.getRequest(rootId, requests[3]?.seq ?? -1)
    expect(retried?.status).toBe('ok')
    expect(retried?.usage).toEqual({ inputTokens: 5, outputTokens: 2 })
    service.dispose()
  })

  it('keeps the failed delegation at zero requests when the child log never materialized', async () => {
    const notFound = new Error('session not found')
    notFound.name = 'SessionPersistenceNotFoundError'
    const reader = new FixtureReader([], notFound, 'child-missing')
    const { service } = await mount(reader)
    const rootId = delegate(service, 'child-missing', true)

    const overview = await service.getTurn(rootId, 1)
    const child = overview?.scopes.find(scope => scope.kind === 'subagent')
    expect(child).toMatchObject({ scopeId: 'child-missing', status: 'failed', requests: [] })
    expect(overview?.turn.failedScopeCount).toBe(1)
    // Not-found is transient: a later refresh retries the open.
    expect(reader.opens.length).toBeGreaterThan(0)
    service.dispose()
  })

  it('stops hammering a durably unreadable log and keeps the empty state', async () => {
    const warnings: string[] = []
    const reader = new FixtureReader([], new Error('unknown event type "future/event"'), 'child-broken')
    const { service } = await mount(reader, warnings)
    const rootId = delegate(service, 'child-broken', false)

    await service.getTurn(rootId, 1)
    await service.getTurn(rootId, 1)
    const overview = await service.getTurn(rootId, 1)
    expect(overview?.scopes.find(scope => scope.kind === 'subagent')?.requests).toEqual([])
    expect(warnings.filter(message => message.includes('child-broken'))).toHaveLength(1)
    service.dispose()
  })
})
